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
const io = require("socket.io").listen(server);
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

const URL_MONGODB = "mongodb://localhost:27017";
const localURL = "http://localhost";
const DB_NAME_MONGODB = "Taxiconnect";
const URL_SEARCH_SERVICES = "http://www.taxiconnectna.com:7007/";
const URL_ROUTE_SERVICES = "http://www.taxiconnectna.com:7008/route?";
const PRICING_SERVICE_PORT = 8989;
const MAP_SERVICE_PORT = 9090;
//const URL_ROUTE_SERVICES = "localhost:8987/route?";

const clientMongo = new MongoClient(URL_MONGODB, { useUnifiedTopology: true });

function resolveDate() {
  //Resolve date
  var date = new Date();
  date = moment(date.getTime()).utcOffset(2);

  dateObject = date;
  date = date.year() + "-" + (date.month() + 1) + "-" + date.date() + " " + date.hour() + ":" + date.minute() + ":" + date.second();
  chaineDateUTC = date;
}
resolveDate();

const port = 9094;

/**
 * Responsible for sending push notification to devices
 */
var sendPushUPNotification = function (data) {
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
    fingerprint = crypto.createHmac("sha512WithRSAEncryption", "TAXICONNECTBASICKEYFINGERPRINTS-RIDES-DELIVERY").update(str).digest("hex");
    resolve(fingerprint);
  } else if (/md5/i.test(encryption)) {
    fingerprint = crypto.createHmac("md5WithRSAEncryption", "TAXICONNECTBASICKEYFINGERPRINTS-RIDES-DELIVERY").update(str).digest("hex");
    resolve(fingerprint);
  } //Other - default
  else {
    fingerprint = crypto.createHmac("sha256", "TAXICONNECTBASICKEYFINGERPRINTS-RIDES-DELIVERY").update(str).digest("hex");
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
    let uniqueString = inputData.user_fingerprint + "-" + inputData.passengersNo + "-" + chaineDateUTC;
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
          parsedData.request_fp = parsedData.user_fingerprint + dateObject.unix(); //Make a fingerprint out of the timestamp
        }
      )
      .finally(() => {
        console.log("here");
        //Continue
        parsedData.taxi_id = false;
        parsedData.payment_method = inputData.paymentMethod.trim().toUpperCase();
        parsedData.connect_type = inputData.connectType;
        parsedData.ride_mode = inputData.rideType;
        parsedData.fare = inputData.fareAmount;
        parsedData.passengers_number = inputData.passengersNo;
        parsedData.request_type = /now/i.test(inputData.timeScheduled) ? "immediate" : "scheduled";
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
              let specifiedTIme = inputData.timeScheduled.split(" ")[2].split(":");
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
              let specifiedTIme = inputData.timeScheduled.split(" ")[2].split(":");
              let tmpDateString = new Date(
                dateObject.year() + "-" + (dateObject.month() + 1) + "-" + dateObject.date() + " " + specifiedTIme[0] + ":" + specifiedTIme[1] + ":00"
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
                  parsedData.trip_simplified_id = parsedData.client_id.substring(0, 15) + dateObject.milliseconds();
                }
              )
              .finally(() => {
                //continue
                parsedData.carTypeSelected = inputData.carTypeSelected;
                parsedData.isAllGoingToSameDestination = inputData.isAllGoingToSameDestination;
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
                  coordinates: { latitude: inputData.pickupData.coordinates[0], longitude: inputData.pickupData.coordinates[1] },
                  location_name: inputData.pickupData.location_name,
                  street_name: inputData.pickupData.street_name,
                  suburb: false,
                  pickup_note: inputData.pickupNote,
                  city: inputData.pickupData.city
                };
                //Auto complete the suburb
                new Promise((res3) => {
                  let url =
                    localURL +
                    ":" +
                    PRICING_SERVICE_PORT +
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
                      actualRider: /^someonelese$/i.test(inputData.actualRider) ? "someoneelse" : "me",
                      actualRiderPhone_number: inputData.actualRiderPhone_number,
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
                                latitude: inputData.destinationData.passenger1Destination.coordinates[0],
                                longitude: inputData.destinationData.passenger1Destination.coordinates[1],
                              },
                              location_name:
                                inputData.destinationData.passenger1Destination.location_name !== undefined &&
                                inputData.destinationData.passenger1Destination.location_name !== false
                                  ? inputData.destinationData.passenger1Destination.location_name
                                  : false,
                              street_name:
                                inputData.destinationData.passenger1Destination.street !== undefined &&
                                inputData.destinationData.passenger1Destination.street !== false
                                  ? inputData.destinationData.passenger1Destination.street
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
                            let passenger1Data = inputData.destinationData.passenger1Destination;
                            cleanInputData.destinationData.push({
                              passenger_number_id: 1,
                              dropoff_type: false,
                              coordinates: { latitude: passenger1Data.coordinates[0], longitude: passenger1Data.coordinates[1] },
                              location_name:
                                passenger1Data.location_name !== undefined && passenger1Data.location_name !== false
                                  ? passenger1Data.location_name
                                  : false,
                              street_name: passenger1Data.street !== undefined && passenger1Data.street !== false ? passenger1Data.street : false,
                              suburb: false,
                              state: false,
                              city: inputData.pickupData.city,
                            });
                            //Passenger2
                            let passenger2Data = inputData.destinationData.passenger2Destination;
                            cleanInputData.destinationData.push({
                              passenger_number_id: 2,
                              dropoff_type: false,
                              coordinates: { latitude: passenger2Data.coordinates[0], longitude: passenger2Data.coordinates[1] },
                              location_name:
                                passenger2Data.location_name !== undefined && passenger2Data.location_name !== false
                                  ? passenger2Data.location_name
                                  : false,
                              street_name: passenger2Data.street !== undefined && passenger2Data.street !== false ? passenger2Data.street : false,
                              suburb: false,
                              state: false,
                              city: inputData.pickupData.city,
                            });
                            //Done
                            res5(cleanInputData);
                          } else if (inputData.passengersNo == 3) {
                            //Passenger1
                            let passenger1Data = inputData.destinationData.passenger1Destination;
                            cleanInputData.destinationData.push({
                              passenger_number_id: 1,
                              dropoff_type: false,
                              coordinates: { latitude: passenger1Data.coordinates[0], longitude: passenger1Data.coordinates[1] },
                              location_name:
                                passenger1Data.location_name !== undefined && passenger1Data.location_name !== false
                                  ? passenger1Data.location_name
                                  : false,
                              street_name: passenger1Data.street !== undefined && passenger1Data.street !== false ? passenger1Data.street : false,
                              suburb: false,
                              state: false,
                              city: inputData.pickupData.city,
                            });
                            //Passenger2
                            let passenger2Data = inputData.destinationData.passenger2Destination;
                            cleanInputData.destinationData.push({
                              passenger_number_id: 2,
                              dropoff_type: false,
                              coordinates: { latitude: passenger2Data.coordinates[0], longitude: passenger2Data.coordinates[1] },
                              location_name:
                                passenger2Data.location_name !== undefined && passenger2Data.location_name !== false
                                  ? passenger2Data.location_name
                                  : false,
                              street_name: passenger2Data.street !== undefined && passenger2Data.street !== false ? passenger2Data.street : false,
                              suburb: false,
                              state: false,
                              city: inputData.pickupData.city,
                            });
                            //Passenger3
                            let passenger3Data = inputData.destinationData.passenger3Destination;
                            cleanInputData.destinationData.push({
                              passenger_number_id: 3,
                              dropoff_type: false,
                              coordinates: { latitude: passenger3Data.coordinates[0], longitude: passenger3Data.coordinates[1] },
                              location_name:
                                passenger3Data.location_name !== undefined && passenger3Data.location_name !== false
                                  ? passenger3Data.location_name
                                  : false,
                              street_name: passenger3Data.street !== undefined && passenger3Data.street !== false ? passenger3Data.street : false,
                              suburb: false,
                              state: false,
                              city: inputData.pickupData.city,
                            });
                            //Done
                            res5(cleanInputData);
                          } else if (inputData.passengersNo == 4) {
                            console.log("Foudn 4");
                            //Passenger1
                            let passenger1Data = inputData.destinationData.passenger1Destination;
                            cleanInputData.destinationData.push({
                              passenger_number_id: 1,
                              dropoff_type: false,
                              coordinates: { latitude: passenger1Data.coordinates[0], longitude: passenger1Data.coordinates[1] },
                              location_name:
                                passenger1Data.location_name !== undefined && passenger1Data.location_name !== false
                                  ? passenger1Data.location_name
                                  : false,
                              street_name: passenger1Data.street !== undefined && passenger1Data.street !== false ? passenger1Data.street : false,
                              suburb: false,
                              state: false,
                              city: inputData.pickupData.city,
                            });
                            //Passenger2
                            let passenger2Data = inputData.destinationData.passenger2Destination;
                            cleanInputData.destinationData.push({
                              passenger_number_id: 2,
                              dropoff_type: false,
                              coordinates: { latitude: passenger2Data.coordinates[0], longitude: passenger2Data.coordinates[1] },
                              location_name:
                                passenger2Data.location_name !== undefined && passenger2Data.location_name !== false
                                  ? passenger2Data.location_name
                                  : false,
                              street_name: passenger2Data.street !== undefined && passenger2Data.street !== false ? passenger2Data.street : false,
                              suburb: false,
                              state: false,
                              city: inputData.pickupData.city,
                            });
                            //Passenger3
                            let passenger3Data = inputData.destinationData.passenger3Destination;
                            cleanInputData.destinationData.push({
                              passenger_number_id: 3,
                              dropoff_type: false,
                              coordinates: { latitude: passenger3Data.coordinates[0], longitude: passenger3Data.coordinates[1] },
                              location_name:
                                passenger3Data.location_name !== undefined && passenger3Data.location_name !== false
                                  ? passenger3Data.location_name
                                  : false,
                              street_name: passenger3Data.street !== undefined && passenger3Data.street !== false ? passenger3Data.street : false,
                              suburb: false,
                              state: false,
                              city: inputData.pickupData.city,
                            });
                            //Passenger4
                            let passenger4Data = inputData.destinationData.passenger4Destination;
                            cleanInputData.destinationData.push({
                              passenger_number_id: 4,
                              dropoff_type: false,
                              coordinates: { latitude: passenger4Data.coordinates[0], longitude: passenger4Data.coordinates[1] },
                              location_name:
                                passenger4Data.location_name !== undefined && passenger4Data.location_name !== false
                                  ? passenger4Data.location_name
                                  : false,
                              street_name: passenger4Data.street !== undefined && passenger4Data.street !== false ? passenger4Data.street : false,
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
                            latitude: inputData.destinationData.passenger1Destination.coordinates[0],
                            longitude: inputData.destinationData.passenger1Destination.coordinates[1],
                          },
                          location_name:
                            inputData.destinationData.passenger1Destination.location_name !== undefined &&
                            inputData.destinationData.passenger1Destination.location_name !== false
                              ? inputData.destinationData.passenger1Destination.location_name
                              : false,
                          street_name:
                            inputData.destinationData.passenger1Destination.street !== undefined &&
                            inputData.destinationData.passenger1Destination.street !== false
                              ? inputData.destinationData.passenger1Destination.street
                              : false,
                          suburb: false,
                          state: false,
                          city: inputData.pickupData.city,
                        });
                        res5(cleanInputData);
                      }
                    }).then(
                      (reslt) => {
                        console.log("HERR");
                        //DONE
                        let url = localURL + ":" + PRICING_SERVICE_PORT + "/manageAutoCompleteSuburbsAndLocationTypes";

                        requestAPI.post(
                          { url, form: { locationData: reslt.destinationData, user_fingerprint: inputData.user_fingerprint } },
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
function intitiateStagedDispatch(snapshotTripInfos, collectionDrivers_profiles, collectionRidesDeliveryData, resolve) {
  //Get the list of all the closest drivers
  let url =
    localURL +
    ":" +
    MAP_SERVICE_PORT +
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
        let
        if (body.response !== undefined || response === false) {
          //Error getting the list - send to all drivers
          new Promise((res) => {
            sendStagedNotificationsDrivers(false, snapshotTripInfos, collectionDrivers_profiles, collectionRidesDeliveryData, res);
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
            sendStagedNotificationsDrivers(body, snapshotTripInfos, collectionDrivers_profiles, collectionRidesDeliveryData, res);
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
          sendStagedNotificationsDrivers(false, snapshotTripInfos, collectionDrivers_profiles, collectionRidesDeliveryData, res);
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
        sendStagedNotificationsDrivers(false, snapshotTripInfos, collectionDrivers_profiles, collectionRidesDeliveryData, res);
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
 * * Closest first (1 driver)
 * after 1min30'' of not accepting
 * * increase the radius (3 drivers)
 * after 1 min of not accepting
 * * increase the radius (5 drivers)
 * after 1 min of not accepting
 * * increase the radius (all the rest)
 * * after 20 min of not accepting - AUTO cancel request
 */
function sendStagedNotificationsDrivers(closestDriversList, snapshotTripInfos, collectionDrivers_profiles, collectionRidesDeliveryData, resolve) {
  if (closestDriversList === false || closestDriversList[0] === undefined) {
    //Send to all the drivers
    //1. Filter the drivers based on trip requirements
    //2. Register their fp in the allowed_drivers_see on the requests
    //3. Send the notifications to each selected one.
    let driverFilter = {
      "operational_state.status": { $regex: /online/i },
      "operational_state.last_location.city": { $regex: snapshotTripInfos.city, $options: "i" },
      "operational_state.last_location.country": { $regex: snapshotTripInfos.country, $options: "i" },
      operation_clearances: { $regex: snapshotTripInfos.ride_type, $options: "i" },
      //Filter the drivers based on the vehicle type if provided
      "operational_state.default_selected_car.vehicle_type": { $regex: snapshotTripInfos.vehicle_type, $options: "i" },
    };
    //..
    collectionDrivers_profiles.find(driverFilter).toArray(function (err, driversProfiles) {
      //Filter the drivers based on their car's maximum capacity (the amount of passengers it can handle)
      //They can receive 3 additional requests on top of the limit of sits in their selected cars.
      driversProfiles = driversProfiles.filter(
        (dData) =>
          dData.operational_state.accepted_requests_infos.total_passengers_number <= dData.operational_state.default_selected_car.max_passengers + 3
      );

      //...Register the drivers fp so that thei can see tne requests
      let driversFp = driversProfiles.map((data) => data.driver_fp); //Drivers fingerprints
      let driversPushNotif_token = driversProfiles.map((data) => data.push_notification_token); //Push notification token
      collectionRidesDeliveryData.updateOne(
        { request_fp: snapshotTripInfos.request_fp },
        { $set: { allowed_drivers_see: driversFp } },
        function (err, reslt) {
          //Send the push notifications
          let message = (message = {
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
          });
          //Send
          sendPushUPNotification(message);
          resolve({ response: "successfully_dispatched" });
        }
      );
    });
  } //Staged send
  else {
    console.log("Staged send");
    let driverFilter = {
      "operational_state.status": { $regex: /online/i },
      "operational_state.last_location.city": { $regex: snapshotTripInfos.city, $options: "i" },
      "operational_state.last_location.country": { $regex: snapshotTripInfos.country, $options: "i" },
      operation_clearances: { $regex: snapshotTripInfos.ride_type, $options: "i" },
      //Filter the drivers based on the vehicle type if provided
      "operational_state.default_selected_car.vehicle_type": { $regex: snapshotTripInfos.vehicle_type, $options: "i" },
    };
    //..
    collectionDrivers_profiles.find(driverFilter).toArray(function (err, driversProfiles) {
      //Filter the drivers based on their car's maximum capacity (the amount of passengers it can handle)
      //They can receive 3 additional requests on top of the limit of sits in their selected cars.
      driversProfiles = driversProfiles.filter(
        (dData) =>
          dData.operational_state.accepted_requests_infos.total_passengers_number <= dData.operational_state.default_selected_car.max_passengers + 3
      );

      //...Register the drivers fp so that thei can see tne requests
      let driversFp = driversProfiles.map((data) => data.driver_fp); //Drivers fingerprints
      let driversPushNotif_token = driversProfiles.map((data) => data.push_notification_token); //Push notification token

      console.log("REQUEST TICKET " + index);
      new Promise((res) => {
        //Asnwer
        console.log("[1] Closest drivers ---ticket: " + index);
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
            if (/staged_dispatch_successfull/i.test(reslt)) {
              //Proceed with the staged dispatch
              //1. Wait for 1 min 30'' - in ms
              console.log("Waiting for 1min 30. ---ticket: " + index);
              setTimeout(() => {
                new Promise((res2) => {
                  console.log("[2] Less closest after 1min 30. ---ticket: " + index);
                  new Promise((res6) => {
                    registerAllowedDriversForRidesAndNotify(
                      snapshotTripInfos.request_fp,
                      snapshotTripInfos,
                      { drivers_fp: driversFp, pushNotif_tokens: driversPushNotif_token },
                      collectionRidesDeliveryData,
                      2,
                      res6
                    );
                  }).then(
                    (reslt) => {
                      if (/staged_dispatch_successfull/i.test(reslt)) {
                        //Proceed with the staged dispatch
                        //Allow these drivers to see the requests athen resolve 2
                        res(true); //Conclude promise 1
                        res2(true); //Conclude promise 2
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
                })
                  .then()
                  .finally(() => {
                    //2. Wait for 1 min
                    console.log("Waiting for 1min ---ticket: " + index);
                    setTimeout(() => {
                      new Promise((res3) => {
                        console.log("[3] Less*2 closest after 1 min. ---ticket: " + index);
                        new Promise((res7) => {
                          registerAllowedDriversForRidesAndNotify(
                            snapshotTripInfos.request_fp,
                            snapshotTripInfos,
                            { drivers_fp: driversFp, pushNotif_tokens: driversPushNotif_token },
                            collectionRidesDeliveryData,
                            3,
                            res7
                          );
                        }).then(
                          (reslt) => {
                            if (/staged_dispatch_successfull/i.test(reslt)) {
                              //Proceed with the staged dispatch
                              //Allow these drivers to see the requests athen resolve 3
                              res3(true); //Conclude promise 3
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
                      })
                        .then()
                        .finally(() => {
                          //3. Wait for 1 min
                          console.log("Waiting for 1min ---ticket: " + index);
                          setTimeout(() => {
                            new Promise((res4) => {
                              console.log("[4] Less*3 closest after 1 min. ---ticket: " + index);
                              new Promise((res8) => {
                                registerAllowedDriversForRidesAndNotify(
                                  snapshotTripInfos.request_fp,
                                  snapshotTripInfos,
                                  { drivers_fp: driversFp, pushNotif_tokens: driversPushNotif_token },
                                  collectionRidesDeliveryData,
                                  4,
                                  res8
                                );
                              }).then(
                                (reslt) => {
                                  if (/staged_dispatch_successfull/i.test(reslt)) {
                                    //Proceed with the staged dispatch
                                    //Allow these drivers to see the requests athen resolve 4
                                    res4(true); //Conclude promise 4
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
                            })
                              .then()
                              .finally(() => {
                                console.log("DONE STAGED DISPATCH  ---ticket: " + index);
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
  driversSnap.drivers_fp = driversSnap.drivers_fp.slice(
    stagedBoundaries[incrementalStage].start,
    stagedBoundaries[incrementalStage].end === false ? driversSnap.drivers_fp.length : stagedBoundaries[incrementalStage].end
  );
  driversSnap.pushNotif_tokens = driversSnap.pushNotif_tokens.slice(
    stagedBoundaries[incrementalStage].start,
    stagedBoundaries[incrementalStage].end === false ? driversSnap.pushNotif_tokens.length : stagedBoundaries[incrementalStage].end
  );
  //Check whether the request was accepted or not.
  let checkAcceptance = {
    "ride_state_vars.isAccepted": false,
    request_fp: request_fp,
  };
  collectionRidesDeliveryData.find(checkAcceptance).toArray(function (err, requestInfos) {
    if (requestInfos.length > 0) {
      //Not yet accepted
      requestInfos = requestInfos[0];
      //...
      //Add the drivers' fingerprints to the allowed_drivers_see
      let updatedAllowedSee = {
        $set: { allowed_drivers_see: [...new Set([...requestInfos.allowed_drivers_see, ...driversSnap.drivers_fp])] },
      };
      collectionRidesDeliveryData.updateOne(checkAcceptance, updatedAllowedSee, function (err, reslt) {
        //Send notifications to the newly registered drivers to the allowed_drivers_see
        //Send the push notifications
        let message = (message = {
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
          include_player_ids: driversSnap.pushNotif_tokens,
        });
        //Send
        sendPushUPNotification(message);
        //...
        resolve({ response: "staged_dispatch_successfull" });
      });
    } //Request already accepted
    else {
      resolve({ response: "request_already_accepted" });
    }
  });
}

/**
 * MAIN
 */

clientMongo.connect(function (err) {
  //if (err) throw err;
  console.log("[+] Dispatch services active.");
  const dbMongo = clientMongo.db(DB_NAME_MONGODB);
  const collectionRidesDeliveryData = dbMongo.collection("rides_deliveries_requests"); //Hold all the requests made (rides and deliveries)
  const collectionRelativeDistances = dbMongo.collection("relative_distances_riders_drivers"); //Hold the relative distances between rider and the drivers (online, same city, same country) at any given time
  const collectionRidersLocation_log = dbMongo.collection("historical_positioning_logs"); //Hold all the location updated from the rider
  const collectionDrivers_profiles = dbMongo.collection("drivers_profiles"); //Hold all the drivers profiles
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
  app.get("/dispatchRidesOrDeliveryRequests", function (req, res) {
    let params = urlParser.parse(req.url, true);
    req = params.query;
    //TEST DATA
    let testData = {
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
    req = testData;
    //...
    if (req.user_fingerprint !== undefined && req.user_fingerprint !== null) {
      //1. CHECK THAT THIS RIDER DOESN'T ALREADY HAVE AN ACTIVE RIDE/DELIVERY
      //Request is considered as completed when the rider has submited a rating.
      let checkPrevRequest = {
        client_id: req.user_fingerprint,
        "ride_state_vars.isRideCompleted_riderSide": false,
      };
      collectionRidesDeliveryData.find(checkPrevRequest).toArray(function (err, prevRequest) {
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
                collectionRidesDeliveryData.insertOne(result, function (err, requestDt) {
                  if (err) {
                    res.send({ response: "Unable_to_make_the_request" });
                  }
                  //..Success
                  //2. INITIATE STAGED toDrivers DISPATCH
                  new Promise((resStaged) => {
                    //FORM THE REQUEST SNAPSHOT
                    let snapshotTripInfos = {
                        user_fingerprint:result.client_id,
                        city: result.pickup_location_infos.city,
                        country: result.country,
                        ride_type: result.ride_mode,
                        vehicle_type: result.carTypeSelected,
                        org_latitude: result.pickup_location_infos.coordinates.latitude,
                        org_longitude: result.pickup_location_infos.coordinates.longitude,
                        request_fp:result.request_fp,
                        pickup_suburb:result.pickup_location_infos.suburb,
                        destination_suburb:result.destinationData[0].suburb,
                        fare: result.fare
                    };
                    intitiateStagedDispatch(snapshotTripInfos, collectionDrivers_profiles, collectionRidesDeliveryData, resStaged)
                  })
                  .then(
                      (result) => {
                        res.send(result);
                      },
                      (error) => {
                          console.log(error);
                        res.send({ response: "Unable_to_make_the_request" });
                      }
                  );
                });
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
});

server.listen(port);
