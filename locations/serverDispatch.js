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
 * @func generateUniqueFingerprint()
 * Generate unique fingerprint for any string size.
 */
function generateUniqueFingerprint(str, encryption = false, resolve) {
  str = str.trim();
  let fingerprint = null;
  if (encryption === false) {
    fingerprint = crypto.createHmac("sha256", "TAXICONNECTBASICKEYFINGERPRINTS-RIDES-DELIVERY").update(str).digest("hex");
    resolve(fingerprint);
  } else if (/md5/i.test(encryption)) {
    fingerprint = crypto.createHmac("md5", "TAXICONNECTBASICKEYFINGERPRINTS-RIDES-DELIVERY").update(str).digest("hex");
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
 * MAIN
 */

clientMongo.connect(function (err) {
  //if (err) throw err;
  console.log("[+] Dispatch services active.");
  const dbMongo = clientMongo.db(DB_NAME_MONGODB);
  const collectionRidersData_repr = dbMongo.collection("rides_deliveries_requests"); //Hold all the requests made (rides and deliveries)
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
    //Parse the data
    new Promise((res) => {
      parseRequestData(req, res);
    }).then(
      (result) => {
        if (result !== false) {
          console.log(result);
          res.send(result);
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
  });
});

server.listen(port);
