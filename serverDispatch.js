require("dotenv").config();
//require("newrelic");
var express = require("express");
const http = require("http");
const fs = require("fs");
const MongoClient = require("mongodb").MongoClient;
const certFile = fs.readFileSync("./rds-combined-ca-bundle.pem");
const { logger } = require("./LogService");

var app = express();
var server = http.createServer(app);
const requestAPI = require("request");
const crypto = require("crypto");
//....
const { promisify } = require("util");
const urlParser = require("url");
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
const redisGet = promisify(redisCluster.get).bind(redisCluster);

var chaineDateUTC = null;
var dateObject = null;
const moment = require("moment");
const { stringify, parse } = require("flatted");

const clientMongo = new MongoClient(process.env.URL_MONGODB, {
  tlsCAFile: certFile, //The DocDB cert
  useUnifiedTopology: true,
  useNewUrlParser: true,
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
    //logger.info("statusCode:", resp.statusCode);
    let data = "";
    resp.on("data", (chunk) => {
      data += chunk;
    });
    resp.on("end", () => {
      //logger.info("Response:", data);
    });
  });

  req.on("error", (e) => {
    //console.error(e);
  });

  req.write(postData);
  req.end();
}

/**
 * Responsible for sending push notification to devices
 */
var sendPushUPNotification = function (data) {
  //logger.info("Notify data");
  //logger.info(data);
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
      ////logger.info("Response:");
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
  //logger.info("INITIAL RECEIVED REQUEST");
  ////logger.info("REQUEST DATA -> ", inputData);
  //! CHECK FOR A POTENTIAL CACHED VALUE FOR recoveredd data (from mysql)
  redisGet(
    `${
      inputData.request_fp !== undefined ? inputData.request_fp : "empty"
    }-recoveredData`
  ).then((resp) => {
    if (resp !== null) {
      //Has a cached value
      resolve(parse(resp));
    } //GO FRESH
    else {
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
              parsedData.request_fp =
                inputData.request_fp !== undefined &&
                inputData.request_fp !== null
                  ? inputData.request_fp
                  : result; //Update with the fingerprint;
            },
            (error) => {
              logger.warn(error);
              parsedData.request_fp =
                parsedData.user_fingerprint + dateObject.unix(); //Make a fingerprint out of the timestamp
            }
          )
          .finally(() => {
            //Continue
            parsedData.taxi_id =
              inputData.taxi_id !== undefined && inputData.taxi_id !== null
                ? inputData.taxi_id
                : false;
            parsedData.payment_method = inputData.paymentMethod
              .trim()
              .toUpperCase();
            parsedData.connect_type = inputData.connectType;
            parsedData.ride_mode = inputData.rideType;
            parsedData.fare = inputData.fareAmount;
            parsedData.isGoingUntilHome =
              inputData.isGoingUntilHome !== undefined &&
              inputData.isGoingUntilHome !== null
                ? /false/i.test(inputData.isGoingUntilHome)
                  ? false
                  : /true/i.test(inputData.isGoingUntilHome)
                  ? true
                  : inputData.isGoingUntilHome
                : false; //! Careful: Doubled the fares for the Economy type
            parsedData.passengers_number = inputData.passengersNo;
            parsedData.request_type = /now/i.test(inputData.timeScheduled)
              ? "immediate"
              : "scheduled";
            parsedData.allowed_drivers_see =
              inputData.taxi_id !== undefined && inputData.taxi_id !== null
                ? [inputData.taxi_id]
                : []; //LIST OF THE DRIVERS WHO CAN SEE THE REQUEST IN THEIR APP.
            //? Add the ccar fingerprint if any
            parsedData.car_fingerprint =
              inputData.car_fingerprint !== undefined &&
              inputData.car_fingerprint !== null
                ? inputData.car_fingerprint
                : false;
            //? Add the delete date if any
            if (
              inputData.date_deleted !== undefined &&
              inputData.date_deleted !== null
            ) {
              parsedData.date_deleted = inputData.date_deleted;
            }
            //Resolve the pickup time
            new Promise((res1) => {
              if (/immediate/i.test(parsedData.request_type)) {
                //Now request - now date
                parsedData.wished_pickup_time = new Date(chaineDateUTC);
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
                  parsedData.wished_pickup_time = new Date(tmpDateString);
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
                  parsedData.wished_pickup_time = new Date(tmpDateString);
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
                //! Clean the country of invalid values
                inputData.country =
                  inputData.country !== "false" &&
                  inputData.country !== false &&
                  inputData.country !== null &&
                  inputData.country !== undefined
                    ? inputData.country
                    : "Namibia";
                //...
                parsedData.country =
                  inputData.country !== "false" &&
                  inputData.country !== false &&
                  inputData.country !== null &&
                  inputData.country !== undefined
                    ? inputData.country
                    : "Namibia";
                //Compute the simplified fingerprint
                new Promise((res2) => {
                  generateUniqueFingerprint(uniqueString, "md5", res2);
                })
                  .then(
                    (result) => {
                      parsedData.trip_simplified_id =
                        inputData.trip_simplified_id !== undefined &&
                        inputData.trip_simplified_id !== null
                          ? inputData.trip_simplified_id
                          : result;
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
                    parsedData.isArrivedToDestination =
                      inputData.isArrivedToDestination !== undefined &&
                      inputData.isArrivedToDestination !== null
                        ? inputData.isArrivedToDestination
                        : false;
                    parsedData.date_dropoff =
                      inputData.date_dropoff !== undefined &&
                      inputData.date_dropoff !== null
                        ? inputData.date_dropoff
                        : false;
                    parsedData.date_pickup =
                      inputData.date_pickup !== undefined &&
                      inputData.date_pickup !== null
                        ? inputData.date_pickup
                        : false;
                    parsedData.date_requested =
                      inputData.date_requested !== undefined &&
                      inputData.date_requested !== null
                        ? inputData.date_requested
                        : new Date(chaineDateUTC);
                    parsedData.date_accepted =
                      inputData.date_accepted !== undefined &&
                      inputData.date_accepted !== null
                        ? inputData.date_accepted
                        : false;
                    //Parse nested data
                    //1. Ride state vars
                    parsedData.ride_state_vars =
                      inputData.ride_state_vars !== undefined &&
                      inputData.ride_state_vars !== null
                        ? inputData.ride_state_vars
                        : {
                            isAccepted: false,
                            inRideToDestination: false,
                            isRideCompleted_driverSide: false,
                            isRideCompleted_riderSide: false,
                            rider_driverRating: "notYet",
                          };
                    //2.Pickup location infos
                    //! Clean the city of invalid values
                    inputData.pickupData.city =
                      inputData.pickupData.city !== "false" &&
                      inputData.pickupData.city !== false &&
                      inputData.pickupData.city !== null &&
                      inputData.pickupData.city !== undefined
                        ? inputData.pickupData.city
                        : "Windhoek";
                    //...
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
                      city:
                        inputData.pickupData.city !== "false" &&
                        inputData.pickupData.city !== false &&
                        inputData.pickupData.city !== null &&
                        inputData.pickupData.city !== undefined
                          ? inputData.pickupData.city
                          : "Windhoek",
                      state: null,
                    };
                    //! APPLY BLUE OCEAN BUG FIX FOR THE PICKUP LOCATION COORDINATES
                    //? Get temporary vars
                    let pickLatitude = parseFloat(
                      parsedData.pickup_location_infos.coordinates.latitude
                    );
                    let pickLongitude = parseFloat(
                      parsedData.pickup_location_infos.coordinates.longitude
                    );
                    //! Coordinates order fix - major bug fix for ocean bug
                    if (
                      pickLatitude !== undefined &&
                      pickLatitude !== null &&
                      pickLatitude !== 0 &&
                      pickLongitude !== undefined &&
                      pickLongitude !== null &&
                      pickLongitude !== 0
                    ) {
                      //? Switch latitude and longitude - check the negative sign
                      if (parseFloat(pickLongitude) < 0) {
                        //Negative - switch
                        parsedData.pickup_location_infos.coordinates.latitude =
                          pickLongitude;
                        parsedData.pickup_location_infos.coordinates.longitude =
                          pickLatitude;
                      }
                    }
                    //!!!
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
                        parsedData.pickup_location_infos.coordinates.latitude +
                        "&longitude=" +
                        parsedData.pickup_location_infos.coordinates.longitude +
                        "&user_fingerprint=" +
                        inputData.user_fingerprint +
                        "&make_new=true";
                      requestAPI(url, function (error, response, body) {
                        if (error === null) {
                          try {
                            body = JSON.parse(body);
                            parsedData.pickup_location_infos.suburb =
                              /Samora Machel Constituency/i.test(body.suburb)
                                ? "Wanaheda"
                                : body.suburb; //! Suburb
                            parsedData.pickup_location_infos.state = body.state; //! State
                            parsedData.pickup_location_infos.location_name =
                              body.location_name !== undefined &&
                              body.location_name !== null &&
                              body.location_name !== false &&
                              body.location_name !== "false"
                                ? body.location_name
                                : parsedData.pickup_location_infos
                                    .location_name; //! Location name
                            parsedData.pickup_location_infos.street_name =
                              body.street_name !== undefined &&
                              body.street_name !== null &&
                              body.street_name !== false &&
                              body.street_name !== "false"
                                ? body.street_name
                                : parsedData.pickup_location_infos.street_name; //! Street name

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
                          receiverName_delivery:
                            inputData.receiverName_delivery,
                          receiverPhone_delivery:
                            inputData.receiverPhone_delivery,
                          packageSize: inputData.packageSizeDelivery,
                        };
                        //4. Rider infos
                        parsedData.rider_infos = {
                          actualRider: /^someonelese$/i.test(
                            inputData.actualRider
                          )
                            ? "someoneelse"
                            : "me",
                          actualRiderPhone_number:
                            inputData.actualRiderPhone_number,
                        };

                        //5. DESTINATION DATA
                        let cleanInputData = { destinationData: null };
                        //Resolve destination infos
                        new Promise((res5) => {
                          cleanInputData.destinationData = [];
                          let tmpSchemaArray = new Array(
                            parseInt(inputData.passengersNo)
                          ).fill(1); //! Just for iterations, nothing more, instead of using for loop, but make it the right size - critical bug fix (Mandatory 4 passengers going to the same direction bug).
                          if (inputData.passengersNo > 1) {
                            //Many passengers
                            //Check if all going to the same destination
                            //? Clean the boolean
                            inputData.isAllGoingToSameDestination =
                              /string/i.test(
                                typeof inputData.isAllGoingToSameDestination
                              )
                                ? inputData.isAllGoingToSameDestination ===
                                  "true"
                                  ? true
                                  : false
                                : inputData.isAllGoingToSameDestination;
                            //? -----------
                            if (
                              inputData.isAllGoingToSameDestination &&
                              inputData.isAllGoingToSameDestination !== false &&
                              inputData.isAllGoingToSameDestination !== "false"
                            ) {
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
                                    inputData.destinationData
                                      .passenger1Destination.location_name !==
                                      undefined &&
                                    inputData.destinationData
                                      .passenger1Destination.location_name !==
                                      false
                                      ? inputData.destinationData
                                          .passenger1Destination.location_name
                                      : false,
                                  street_name:
                                    inputData.destinationData
                                      .passenger1Destination.street !==
                                      undefined &&
                                    inputData.destinationData
                                      .passenger1Destination.street !== false
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
                                  inputData.destinationData
                                    .passenger1Destination;
                                cleanInputData.destinationData.push({
                                  passenger_number_id: 1,
                                  dropoff_type: false,
                                  coordinates: {
                                    latitude: passenger1Data.coordinates[1],
                                    longitude: passenger1Data.coordinates[0],
                                  },
                                  location_name:
                                    passenger1Data.location_name !==
                                      undefined &&
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
                                  inputData.destinationData
                                    .passenger2Destination;
                                cleanInputData.destinationData.push({
                                  passenger_number_id: 2,
                                  dropoff_type: false,
                                  coordinates: {
                                    latitude: passenger2Data.coordinates[1],
                                    longitude: passenger2Data.coordinates[0],
                                  },
                                  location_name:
                                    passenger2Data.location_name !==
                                      undefined &&
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
                                  inputData.destinationData
                                    .passenger1Destination;
                                cleanInputData.destinationData.push({
                                  passenger_number_id: 1,
                                  dropoff_type: false,
                                  coordinates: {
                                    latitude: passenger1Data.coordinates[1],
                                    longitude: passenger1Data.coordinates[0],
                                  },
                                  location_name:
                                    passenger1Data.location_name !==
                                      undefined &&
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
                                  inputData.destinationData
                                    .passenger2Destination;
                                cleanInputData.destinationData.push({
                                  passenger_number_id: 2,
                                  dropoff_type: false,
                                  coordinates: {
                                    latitude: passenger2Data.coordinates[1],
                                    longitude: passenger2Data.coordinates[0],
                                  },
                                  location_name:
                                    passenger2Data.location_name !==
                                      undefined &&
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
                                  inputData.destinationData
                                    .passenger3Destination;
                                cleanInputData.destinationData.push({
                                  passenger_number_id: 3,
                                  dropoff_type: false,
                                  coordinates: {
                                    latitude: passenger3Data.coordinates[1],
                                    longitude: passenger3Data.coordinates[0],
                                  },
                                  location_name:
                                    passenger3Data.location_name !==
                                      undefined &&
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
                                //Passenger1
                                let passenger1Data =
                                  inputData.destinationData
                                    .passenger1Destination;
                                cleanInputData.destinationData.push({
                                  passenger_number_id: 1,
                                  dropoff_type: false,
                                  coordinates: {
                                    latitude: passenger1Data.coordinates[1],
                                    longitude: passenger1Data.coordinates[0],
                                  },
                                  location_name:
                                    passenger1Data.location_name !==
                                      undefined &&
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
                                  inputData.destinationData
                                    .passenger2Destination;
                                cleanInputData.destinationData.push({
                                  passenger_number_id: 2,
                                  dropoff_type: false,
                                  coordinates: {
                                    latitude: passenger2Data.coordinates[1],
                                    longitude: passenger2Data.coordinates[0],
                                  },
                                  location_name:
                                    passenger2Data.location_name !==
                                      undefined &&
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
                                  inputData.destinationData
                                    .passenger3Destination;
                                cleanInputData.destinationData.push({
                                  passenger_number_id: 3,
                                  dropoff_type: false,
                                  coordinates: {
                                    latitude: passenger3Data.coordinates[1],
                                    longitude: passenger3Data.coordinates[0],
                                  },
                                  location_name:
                                    passenger3Data.location_name !==
                                      undefined &&
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
                                  inputData.destinationData
                                    .passenger4Destination;
                                cleanInputData.destinationData.push({
                                  passenger_number_id: 4,
                                  dropoff_type: false,
                                  coordinates: {
                                    latitude: passenger4Data.coordinates[1],
                                    longitude: passenger4Data.coordinates[0],
                                  },
                                  location_name:
                                    passenger4Data.location_name !==
                                      undefined &&
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
                                //logger.info("here", body);
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
                                      //! Replace Samora Machel Constituency by Wanaheda
                                      new Promise((resReformat) => {
                                        parsedData.destinationData.map(
                                          (destination, index) => {
                                            if (
                                              /Samora Machel Constituency/i.test(
                                                destination.suburb
                                              )
                                            ) {
                                              parsedData.destinationData[
                                                index
                                              ].suburb = "Wanaheda";
                                            }
                                          }
                                        );
                                        resReformat(true);
                                      })
                                        .then(
                                          () => {
                                            //! CACHE RECOVERED REQUEST
                                            if (
                                              inputData.recovered_request !==
                                                undefined &&
                                              inputData.recovered_request &&
                                              parsedData !== false &&
                                              parsedData !== undefined &&
                                              parsedData !== null
                                            ) {
                                              new Promise((resCache) => {
                                                redisCluster.setex(
                                                  `${inputData.request_fp}-recoveredData`,
                                                  process.env
                                                    .REDIS_EXPIRATION_5MIN,
                                                  stringify(parsedData)
                                                );
                                                resCache(true);
                                              })
                                                .then()
                                                .catch(() => {});
                                            }
                                            //? DONE
                                            resolve(parsedData);
                                          },
                                          (error) => {
                                            //logger.info(error);
                                            resolve(parsedData);
                                          }
                                        )
                                        .catch((error) => {
                                          //logger.info(error);
                                          resolve(parsedData);
                                        });
                                    }
                                  } catch (error) {
                                    //logger.info(error);
                                    resolve(false);
                                  }
                                } else {
                                  resolve(false);
                                }
                              }
                            );
                          },
                          (error) => {
                            //logger.info(error);
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
  });
}

/**
 * @func intitiateStagedDispatch
 * @param resolve
 * @param snapshotTripInfos: this will contain basic review of the trip, specifically the fare, passengers number, ride type (ride/delivery),
 * @param collectionRidesDeliveryData: rides and delivery collection
 * @param collectionDrivers_profiles: drivers profiles collection
 * @param channel: the Rabbitmq communication channel.
 * connect type (connectMe/connectUS).
 * Responsible for sending notifications to drivers and a staged manner:
 * ? Closest first (1 driver)
 * after 1min30'' of not accepting
 * ? increase the radius (3 drivers)
 * after 1 min of not accepting
 * ? increase the radius (5 drivers)
 * after 1 min of not accepting
 * ? increase the radius (all the rest)
 * ? after 20 min of not accepting - AUTO cancel request
 */
function intitiateStagedDispatch(
  snapshotTripInfos,
  collectionDrivers_profiles,
  collectionRidesDeliveryData,
  channel,
  resolve
) {
  //Get the list of all the closest drivers
  /**
   * Can use @param includeOfflineDrivers to also subscribe offline drivers to a request.
   */
  /*new Promise((res) => {
    sendStagedNotificationsDrivers(
      false,
      snapshotTripInfos,
      collectionDrivers_profiles,
      collectionRidesDeliveryData,
      res
    );
  }).then(
    (result) => {
      //logger.info(result);
      resolve(result);
    },
    (error) => {
      //logger.info(error);
      resolve(false);
    }
  );*/
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
    "&vehicle_type=" +
    snapshotTripInfos.vehicle_type +
    "&city=" +
    snapshotTripInfos.city +
    "&country=" +
    snapshotTripInfos.country +
    "&list_limit=all";
  requestAPI(url, function (error, response, body) {
    logger.info(body);
    try {
      body = JSON.parse(body);
      if (body.response !== undefined) {
        //Error getting the list - send to all drivers
        new Promise((res) => {
          sendStagedNotificationsDrivers(
            false,
            snapshotTripInfos,
            collectionDrivers_profiles,
            collectionRidesDeliveryData,
            channel,
            res
          );
        }).then(
          (result) => {
            //logger.info(result);
            resolve(result);
          },
          (error) => {
            //logger.info(error);
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
            channel,
            res
          );
        }).then(
          (result) => {
            //logger.info(result);
            resolve(result);
          },
          (error) => {
            //logger.info(error);
            resolve(false);
          }
        );
      }
    } catch (error) {
      //logger.info(error);
      //Error getting the list of closest drivers - send to all the drivers
      new Promise((res) => {
        sendStagedNotificationsDrivers(
          false,
          snapshotTripInfos,
          collectionDrivers_profiles,
          collectionRidesDeliveryData,
          channel,
          res
        );
      }).then(
        (result) => {
          //logger.info(result);
          resolve(result);
        },
        (error) => {
          //logger.info(error);
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
 * @param channel: the RabbitMq communication channel.
 * in the last scenario, dispatch to all the online drivers.
 * Responsible for EXECUTING the staged sending of notifications and adding correspoding drivers to
 * the allowed_drivers_see list of the request so that they can access the trip from their app if not
 * yet accepted.
 * ? Closest first (1 driver)
 * after 35sec of not accepting
 * ? increase the radius (5 drivers)
 * after 30sec of not accepting
 * ? increase the radius (10 drivers)
 * after 30sec of not accepting
 * ? increase the radius (all the rest)
 * ! after 20 min of not accepting - AUTO cancel request
 * * 2 DISPATCH STRATEGIES:
 * * 1. Targeted: sends rides serially to the closest drivers first with a reasonable time delay to increase
 * * ************ the chances of the request to be accepted by the optimal driver.
 * * 2. General: sends rides to all the drivers in the city, giving the same probability to everyone of accepting
 * * ************ the request, decreasing the probability of the optimal driver to accept.
 */
function sendStagedNotificationsDrivers(
  closestDriversList,
  snapshotTripInfos,
  collectionDrivers_profiles,
  collectionRidesDeliveryData,
  channel,
  resolve
) {
  if (/general/i.test(process.env.RIDES_DISPATCH_STRATEGY)) {
    //Send to all the drivers
    //1. Filter the drivers based on trip requirements
    //2. Register their fp in the allowed_drivers_see on the requests
    //3. Send the notifications to each selected one.
    let driverFilter = {
      "operational_state.status": { $in: ["online"] },
      "operational_state.last_location.city": snapshotTripInfos.city,
      /*"operational_state.last_location.country": snapshotTripInfos.country,
      operation_clearances: snapshotTripInfos.ride_type,*/
      //Filter the drivers based on the vehicle type if provided
      "operational_state.default_selected_car.vehicle_type":
        snapshotTripInfos.vehicle_type,
    };
    //..
    collectionDrivers_profiles
      .find(driverFilter)
      //!.collation({ locale: "en", strength: 2 })
      .toArray(function (err, driversProfiles) {
        //Filter the drivers based on their car's maximum capacity (the amount of passengers it can handle)
        //They can receive 3 additional requests on top of the limit of sits in their selected cars.
        //! DISBALE PASSENGERS CHECK
        /*driversProfiles = driversProfiles.filter(
          (dData) =>
            dData.operational_state.accepted_requests_infos === null ||
            dData.operational_state.accepted_requests_infos
              .total_passengers_number <=
              dData.operational_state.default_selected_car.max_passengers + 3 ||
            dData.operational_state.accepted_requests_infos === undefined ||
            dData.operational_state.accepted_requests_infos === null ||
            dData.operational_state.accepted_requests_infos
              .total_passengers_number === undefined ||
            dData.operational_state.accepted_requests_infos
              .total_passengers_number === null
        );*/

        //...Register the drivers fp so that thei can see tne requests
        let driversFp = driversProfiles.map((data) => data.driver_fingerprint); //Drivers fingerprints
        let driversPushNotif_token = driversProfiles.map((data) => {
          if (/online/i.test(data.operational_state.status)) {
            return data.operational_state.push_notification_token !== null &&
              data.operational_state.push_notification_token !== undefined
              ? data.operational_state.push_notification_token.userId
              : null;
          } else {
            return null; //Only notify the drivers that are online.
          }
        }); //Push notification token
        collectionRidesDeliveryData.updateOne(
          { request_fp: snapshotTripInfos.request_fp },
          { $set: { allowed_drivers_see: driversFp } },
          function (err, reslt) {
            //! Update the drivers' list data located in the same city
            new Promise((resCompute) => {
              let parentPromises = driversFp.map((fingerprint) => {
                return new Promise((resInside) => {
                  //! RABBITMQ MESSAGE
                  channel.assertQueue(
                    process.env.TRIPS_UPDATE_AFTER_BOOKING_QUEUE_NAME,
                    {
                      durable: true,
                    }
                  );
                  //Send message
                  let message = {
                    user_fingerprint: fingerprint,
                    requestType: /scheduled/i.test(
                      snapshotTripInfos.request_type
                    )
                      ? "scheduled"
                      : snapshotTripInfos.ride_type,
                    user_nature: "driver",
                  };

                  channel.sendToQueue(
                    process.env.TRIPS_UPDATE_AFTER_BOOKING_QUEUE_NAME,
                    Buffer.from(JSON.stringify(message)),
                    {
                      persistent: true,
                    }
                  );
                  //...
                  resInside(true);
                });
              });
              //...
              Promise.all(parentPromises)
                .then(() => {
                  resCompute(true);
                })
                .catch(() => {
                  resCompute(true);
                });
            })
              .then()
              .catch();
            //! -------------
            //Send the push notifications - FOR DRIVERS
            //! Safety net against undefined suburbs
            snapshotTripInfos.pickup_suburb =
              snapshotTripInfos.pickup_suburb === undefined
                ? false
                : snapshotTripInfos.pickup_suburb;
            //!
            new Promise((resNotify) => {
              let message = {
                app_id: process.env.DRIVERS_APP_ID_ONESIGNAL,
                android_channel_id: /RIDE/i.test(snapshotTripInfos.ride_type)
                  ? process.env.DRIVERS_ONESIGNAL_CHANNEL_NEW_NOTIFICATION
                  : process.env.DRIVERS_ONESIGNAL_CHANNEL_NEW_NOTIFICATION, //Ride or delivery channel
                priority: 10,
                contents: /RIDE/i.test(snapshotTripInfos.ride_type)
                  ? {
                      en:
                        "You have a new ride request " +
                        (snapshotTripInfos.pickup_suburb !== false
                          ? "from " + snapshotTripInfos.pickup_suburb !==
                              undefined &&
                            snapshotTripInfos.pickup_suburb !== false &&
                            snapshotTripInfos.pickup_suburb !== null
                            ? snapshotTripInfos.pickup_suburb.toUpperCase()
                            : "near your location" +
                                " to " +
                                snapshotTripInfos.destination_suburb !==
                                undefined &&
                              snapshotTripInfos.destination_suburb !== false &&
                              snapshotTripInfos.destination_suburb !== null
                            ? snapshotTripInfos.destination_suburb.toUpperCase()
                            : "near your location" +
                              ". Click here for more details."
                          : "near your location, click here for more details."),
                    }
                  : {
                      en:
                        "You have a new delivery request " +
                        (snapshotTripInfos.pickup_suburb !== false
                          ? "from " + snapshotTripInfos.pickup_suburb !==
                              undefined &&
                            snapshotTripInfos.pickup_suburb !== false &&
                            snapshotTripInfos.pickup_suburb !== null
                            ? snapshotTripInfos.pickup_suburb.toUpperCase()
                            : "near your location" +
                                " to " +
                                snapshotTripInfos.destination_suburb !==
                                undefined &&
                              snapshotTripInfos.destination_suburb !== false &&
                              snapshotTripInfos.destination_suburb !== null
                            ? snapshotTripInfos.destination_suburb.toUpperCase()
                            : "near your location" +
                              ". Click here for more details."
                          : "near your location, click here for more details."),
                    },
                headings: /RIDE/i.test(snapshotTripInfos.ride_type)
                  ? { en: "New ride request, N$" + snapshotTripInfos.fare }
                  : { en: "New delivery request, N$" + snapshotTripInfos.fare },
                content_available: true,
                include_player_ids: driversPushNotif_token,
              };
              //Send
              sendPushUPNotification(message);
              resNotify(true);
            })
              .then()
              .catch();

            new Promise((resNotify) => {
              let message = {
                app_id: process.env.DRIVERS_APP_ID_ONESIGNAL,
                android_channel_id: /RIDE/i.test(snapshotTripInfos.ride_type)
                  ? process.env.DRIVERS_ONESIGNAL_CHANNEL_NEW_NOTIFICATION
                  : process.env.DRIVERS_ONESIGNAL_CHANNEL_NEW_NOTIFICATION, //Ride or delivery channel
                priority: 10,
                contents: /RIDE/i.test(snapshotTripInfos.ride_type)
                  ? {
                      en:
                        "You have a new ride request " +
                        (snapshotTripInfos.pickup_suburb !== false
                          ? "from " + snapshotTripInfos.pickup_suburb !==
                              undefined &&
                            snapshotTripInfos.pickup_suburb !== false &&
                            snapshotTripInfos.pickup_suburb !== null
                            ? snapshotTripInfos.pickup_suburb.toUpperCase()
                            : "near your location" +
                                " to " +
                                snapshotTripInfos.destination_suburb !==
                                undefined &&
                              snapshotTripInfos.destination_suburb !== false &&
                              snapshotTripInfos.destination_suburb !== null
                            ? snapshotTripInfos.destination_suburb.toUpperCase()
                            : "near your location" +
                              ". Click here for more details."
                          : "near your location, click here for more details."),
                    }
                  : {
                      en:
                        "You have a new delivery request " +
                        (snapshotTripInfos.pickup_suburb !== false
                          ? "from " + snapshotTripInfos.pickup_suburb !==
                              undefined &&
                            snapshotTripInfos.pickup_suburb !== false &&
                            snapshotTripInfos.pickup_suburb !== null
                            ? snapshotTripInfos.pickup_suburb.toUpperCase()
                            : "near your location" +
                                " to " +
                                snapshotTripInfos.destination_suburb !==
                                undefined &&
                              snapshotTripInfos.destination_suburb !== false &&
                              snapshotTripInfos.destination_suburb !== null
                            ? snapshotTripInfos.destination_suburb.toUpperCase()
                            : "near your location" +
                              ". Click here for more details."
                          : "near your location, click here for more details."),
                    },
                headings: /RIDE/i.test(snapshotTripInfos.ride_type)
                  ? { en: "New ride request, N$" + snapshotTripInfos.fare }
                  : { en: "New delivery request, N$" + snapshotTripInfos.fare },
                content_available: true,
                include_player_ids: driversPushNotif_token,
              };
              //Send
              sendPushUPNotification(message);
              resNotify(true);
            })
              .then()
              .catch();

            //! PARALLEL MESSAGING FOR THE SUPER ACCOUNT
            new Promise((resNotify) => {
              collectionDrivers_profiles
                .find({
                  driver_fingerprint:
                    "88889d088e03653169b9c18193a0b8dd329ea1e43eb0626ef9f16b5b979694a429710561a3cb3ddae",
                })
                .toArray(function (err, superAccountDriver) {
                  if (err) {
                    resNotify(false);
                  }
                  //...
                  if (
                    superAccountDriver !== undefined &&
                    superAccountDriver.length > 0
                  ) {
                    let message = {
                      app_id: process.env.DRIVERS_APP_ID_ONESIGNAL,
                      android_channel_id: /RIDE/i.test(
                        snapshotTripInfos.ride_type
                      )
                        ? process.env.DRIVERS_ONESIGNAL_CHANNEL_NEW_NOTIFICATION
                        : process.env
                            .DRIVERS_ONESIGNAL_CHANNEL_NEW_NOTIFICATION, //Ride or delivery channel
                      priority: 10,
                      contents: /RIDE/i.test(snapshotTripInfos.ride_type)
                        ? {
                            en:
                              "You have a new ride request " +
                              (snapshotTripInfos.pickup_suburb !== false
                                ? "from " + snapshotTripInfos.pickup_suburb !==
                                    undefined &&
                                  snapshotTripInfos.pickup_suburb !== false &&
                                  snapshotTripInfos.pickup_suburb !== null
                                  ? snapshotTripInfos.pickup_suburb.toUpperCase()
                                  : "near your location" +
                                      " to " +
                                      snapshotTripInfos.destination_suburb !==
                                      undefined &&
                                    snapshotTripInfos.destination_suburb !==
                                      false &&
                                    snapshotTripInfos.destination_suburb !==
                                      null
                                  ? snapshotTripInfos.destination_suburb.toUpperCase()
                                  : "near your location" +
                                    ". Click here for more details."
                                : "near your location, click here for more details."),
                          }
                        : {
                            en:
                              "You have a new delivery request " +
                              (snapshotTripInfos.pickup_suburb !== false
                                ? "from " + snapshotTripInfos.pickup_suburb !==
                                    undefined &&
                                  snapshotTripInfos.pickup_suburb !== false &&
                                  snapshotTripInfos.pickup_suburb !== null
                                  ? snapshotTripInfos.pickup_suburb.toUpperCase()
                                  : "near your location" +
                                      " to " +
                                      snapshotTripInfos.destination_suburb !==
                                      undefined &&
                                    snapshotTripInfos.destination_suburb !==
                                      false &&
                                    snapshotTripInfos.destination_suburb !==
                                      null
                                  ? snapshotTripInfos.destination_suburb.toUpperCase()
                                  : "near your location" +
                                    ". Click here for more details."
                                : "near your location, click here for more details."),
                          },
                      headings: /RIDE/i.test(snapshotTripInfos.ride_type)
                        ? {
                            en: "New ride request, N$" + snapshotTripInfos.fare,
                          }
                        : {
                            en:
                              "New delivery request, N$" +
                              snapshotTripInfos.fare,
                          },
                      content_available: true,
                      include_player_ids: [
                        superAccountDriver[0].operational_state
                          .push_notification_token !== null &&
                        superAccountDriver[0].operational_state
                          .push_notification_token !== undefined
                          ? superAccountDriver[0].operational_state
                              .push_notification_token.userId
                          : null,
                      ],
                    };
                    //Send
                    sendPushUPNotification(message);
                    resNotify(true);
                  } else {
                    resNotify(false);
                  }
                });
            })
              .then()
              .catch();

            //?---Done
            resolve({ response: "successfully_dispatched" });
          }
        );
      });
  } //? TARGETED DISPATCH
  else {
    if (
      closestDriversList === false ||
      closestDriversList[0] === undefined ||
      closestDriversList.response !== undefined ||
      /no_close_drivers_found/i.test(closestDriversList.response)
    ) {
      //Send to all the drivers
      //1. Filter the drivers based on trip requirements
      //2. Register their fp in the allowed_drivers_see on the requests
      //3. Send the notifications to each selected one.
      let driverFilter = {
        "operational_state.status": { $in: ["online"] },
        "operational_state.last_location.city": snapshotTripInfos.city,
        /*"operational_state.last_location.country": snapshotTripInfos.country,
        operation_clearances: snapshotTripInfos.ride_type,*/
        //Filter the drivers based on the vehicle type if provided
        "operational_state.default_selected_car.vehicle_type":
          snapshotTripInfos.vehicle_type,
      };
      //..
      collectionDrivers_profiles
        .find(driverFilter)
        //!.collation({ locale: "en", strength: 2 })
        .toArray(function (err, driversProfiles) {
          //Filter the drivers based on their car's maximum capacity (the amount of passengers it can handle)
          //They can receive 3 additional requests on top of the limit of sits in their selected cars.
          //! DISBALE PASSENGERS CHECK
          /*driversProfiles = driversProfiles.filter(
          (dData) =>
            dData.operational_state.accepted_requests_infos === null ||
            dData.operational_state.accepted_requests_infos
              .total_passengers_number <=
              dData.operational_state.default_selected_car.max_passengers + 3 ||
            dData.operational_state.accepted_requests_infos === undefined ||
            dData.operational_state.accepted_requests_infos === null ||
            dData.operational_state.accepted_requests_infos
              .total_passengers_number === undefined ||
            dData.operational_state.accepted_requests_infos
              .total_passengers_number === null
        );*/

          //...Register the drivers fp so that thei can see tne requests
          let driversFp = driversProfiles.map(
            (data) => data.driver_fingerprint
          ); //Drivers fingerprints
          let driversPushNotif_token = driversProfiles.map((data) => {
            if (/online/i.test(data.operational_state.status)) {
              return data.operational_state.push_notification_token !== null &&
                data.operational_state.push_notification_token !== undefined
                ? data.operational_state.push_notification_token.userId
                : null;
            } else {
              return null; //Only notify the drivers that are online.
            }
          }); //Push notification token
          collectionRidesDeliveryData.updateOne(
            { request_fp: snapshotTripInfos.request_fp },
            { $set: { allowed_drivers_see: driversFp } },
            function (err, reslt) {
              //! Update the drivers' list data located in the same city
              new Promise((resCompute) => {
                driversFp.map((fingerprint) => {
                  //! RABBITMQ MESSAGE
                  channel.assertQueue(
                    process.env.TRIPS_UPDATE_AFTER_BOOKING_QUEUE_NAME,
                    {
                      durable: true,
                    }
                  );
                  //Send message
                  let message = {
                    user_fingerprint: fingerprint,
                    requestType: /scheduled/i.test(
                      snapshotTripInfos.request_type
                    )
                      ? "scheduled"
                      : snapshotTripInfos.ride_type,
                    user_nature: "driver",
                  };
                  channel.sendToQueue(
                    process.env.TRIPS_UPDATE_AFTER_BOOKING_QUEUE_NAME,
                    Buffer.from(JSON.stringify(message)),
                    {
                      persistent: true,
                    }
                  );
                });
                //...
                resCompute(true);
              })
                .then()
                .catch();
              //! -------------
              //Send the push notifications - FOR DRIVERS
              let message = {
                app_id: process.env.DRIVERS_APP_ID_ONESIGNAL,
                android_channel_id: /RIDE/i.test(snapshotTripInfos.ride_type)
                  ? process.env.DRIVERS_ONESIGNAL_CHANNEL_NEW_NOTIFICATION
                  : process.env.DRIVERS_ONESIGNAL_CHANNEL_NEW_NOTIFICATION, //Ride or delivery channel
                priority: 10,
                contents: /RIDE/i.test(snapshotTripInfos.ride_type)
                  ? {
                      en:
                        "You have a new ride request " +
                        (snapshotTripInfos.pickup_suburb !== false
                          ? "from " + snapshotTripInfos.pickup_suburb !==
                              undefined &&
                            snapshotTripInfos.pickup_suburb !== false &&
                            snapshotTripInfos.pickup_suburb !== null
                            ? snapshotTripInfos.pickup_suburb.toUpperCase()
                            : "near your location" +
                                " to " +
                                snapshotTripInfos.destination_suburb !==
                                undefined &&
                              snapshotTripInfos.destination_suburb !== false &&
                              snapshotTripInfos.destination_suburb !== null
                            ? snapshotTripInfos.destination_suburb.toUpperCase()
                            : "near your location" +
                              ". Click here for more details."
                          : "near your location, click here for more details."),
                    }
                  : {
                      en:
                        "You have a new delivery request " +
                        (snapshotTripInfos.pickup_suburb !== false
                          ? "from " + snapshotTripInfos.pickup_suburb !==
                              undefined &&
                            snapshotTripInfos.pickup_suburb !== false &&
                            snapshotTripInfos.pickup_suburb !== null
                            ? snapshotTripInfos.pickup_suburb.toUpperCase()
                            : "near your location" +
                                " to " +
                                snapshotTripInfos.destination_suburb !==
                                undefined &&
                              snapshotTripInfos.destination_suburb !== false &&
                              snapshotTripInfos.destination_suburb !== null
                            ? snapshotTripInfos.destination_suburb.toUpperCase()
                            : "near your location" +
                              ". Click here for more details."
                          : "near your location, click here for more details."),
                    },
                headings: /RIDE/i.test(snapshotTripInfos.ride_type)
                  ? { en: "New ride request, N$" + snapshotTripInfos.fare }
                  : { en: "New delivery request, N$" + snapshotTripInfos.fare },
                content_available: true,
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
      logger.info("Staged send");
      //...Register the drivers fp so that they can see tne requests
      let driversFp = closestDriversList.map((data) => data.driver_fingerprint); //Drivers fingerprints
      let driversPushNotif_token = closestDriversList.map(
        (data) => data.push_notification_token
      ); //Push notification token

      new Promise((res) => {
        //Answer
        logger.info(
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
            //! Update the drivers' list data located in the same city
            new Promise((resCompute) => {
              driversFp.map((fingerprint) => {
                //! RABBITMQ MESSAGE
                channel.assertQueue(
                  process.env.TRIPS_UPDATE_AFTER_BOOKING_QUEUE_NAME,
                  {
                    durable: true,
                  }
                );
                //Send message
                let message = {
                  user_fingerprint: fingerprint,
                  requestType: /scheduled/i.test(snapshotTripInfos.request_type)
                    ? "scheduled"
                    : snapshotTripInfos.ride_type,
                  user_nature: "driver",
                };
                channel.sendToQueue(
                  process.env.TRIPS_UPDATE_AFTER_BOOKING_QUEUE_NAME,
                  Buffer.from(JSON.stringify(message)),
                  {
                    persistent: true,
                  }
                );
              });
              //...
              resCompute(true);
            })
              .then()
              .catch();
            //! -------------
            if (/staged_dispatch_successfull/i.test(reslt.response)) {
              //CONCLUDE THE REQUEST
              resolve({ response: "successfully_dispatched" });
              //Proceed with the staged dispatch
              //1. Wait for 1 min 00'' - in ms
              logger.info(
                "Waiting for 35sec. ---ticket: " + snapshotTripInfos.request_fp
              );
              setTimeout(() => {
                new Promise((res2) => {
                  logger.info(
                    "[2] Less closest after 30sec. ---ticket: " +
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
                        logger.info(
                          "DONE STAGED DISPATCH  ---ticket: " +
                            snapshotTripInfos.request_fp
                        );
                        resolve({ response: "successfully_dispatched" });
                      }
                    },
                    (error) => {
                      logger.info(
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
                    //2. Wait for 30 sec
                    logger.info(
                      "Waiting for 30sec ---ticket: " +
                        snapshotTripInfos.request_fp
                    );
                    setTimeout(() => {
                      new Promise((res3) => {
                        logger.info(
                          "[3] Less*2 closest after 30sec. ---ticket: " +
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
                              /staged_dispatch_successfull/i.test(
                                reslt.response
                              )
                            ) {
                              //Proceed with the staged dispatch
                              //Allow these drivers to see the requests athen resolve 3
                              res3(true); //Conclude promise 3
                            } //End the staged dispatch - done
                            else {
                              logger.info(
                                "DONE STAGED DISPATCH  ---ticket: " +
                                  snapshotTripInfos.request_fp
                              );
                              resolve({ response: "successfully_dispatched" });
                            }
                          },
                          (error) => {
                            logger.info(
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
                          logger.info(
                            "Waiting for 30sec ---ticket: " +
                              snapshotTripInfos.request_fp
                          );
                          setTimeout(() => {
                            new Promise((res4) => {
                              logger.info(
                                "[4] Less*3 closest after 30sec. ---ticket: " +
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
                                    logger.info(
                                      "DONE STAGED DISPATCH  ---ticket: " +
                                        snapshotTripInfos.request_fp
                                    );
                                    resolve({
                                      response: "successfully_dispatched",
                                    });
                                  }
                                },
                                (error) => {
                                  logger.info(
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
                                logger.info(
                                  "DONE STAGED DISPATCH  ---ticket: " +
                                    snapshotTripInfos.request_fp
                                );
                                //Done FULL STAGED DISPATCH!
                                resolve({
                                  response: "successfully_dispatched",
                                });
                              });
                          }, 1 * 30 * 1000);
                        });
                    }, 1 * 30 * 1000);
                  });
              }, 35 * 1000);
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
  //? Fit back to boundary.limit max
  if (incrementalStage > 4) {
    incrementalStage = 4;
  }
  //Staged boundaries
  let stagedBoundaries = {
    1: { start: 0, end: 1 },
    2: { start: 1, end: 6 },
    3: { start: 4, end: 11 },
    4: { start: 9, end: false },
  };
  let originalAllDrivers_fp = driversSnap.drivers_fp;
  //Slice the drivers fp and push notif tokens to be within the boundaries
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

  //Check whether the request was accepted or not.
  let checkAcceptance = {
    "ride_state_vars.isAccepted": false,
    request_fp: request_fp,
  }; //?Indexed
  collectionRidesDeliveryData
    .find(checkAcceptance)
    .toArray(function (err, requestInfos) {
      if (
        requestInfos !== undefined &&
        requestInfos.length > 0 &&
        driversSnap.drivers_fp.length > 0
      ) {
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
            //logger.info(err);
            //Send notifications to the newly registered drivers to the allowed_drivers_see
            //Send the push notifications
            let message = {
              app_id: process.env.DRIVERS_APP_ID_ONESIGNAL,
              android_channel_id: /RIDE/i.test(snapshotTripInfos.ride_type)
                ? process.env.DRIVERS_ONESIGNAL_CHANNEL_NEW_NOTIFICATION
                : process.env.DRIVERS_ONESIGNAL_CHANNEL_NEW_NOTIFICATION, //Ride or delivery channel
              priority: 10,
              contents: /RIDE/i.test(snapshotTripInfos.ride_type)
                ? {
                    en:
                      "You have a new ride request " +
                      (snapshotTripInfos.pickup_suburb !== false
                        ? "from " + snapshotTripInfos.pickup_suburb !==
                          undefined
                          ? snapshotTripInfos.pickup_suburb !== undefined &&
                            snapshotTripInfos.pickup_suburb !== false &&
                            snapshotTripInfos.pickup_suburb !== null
                            ? snapshotTripInfos.pickup_suburb.toUpperCase()
                            : "near your location"
                          : "near your location" +
                              " to " +
                              snapshotTripInfos.pickup_suburb !==
                            undefined
                          ? snapshotTripInfos.pickup_suburb !== undefined &&
                            snapshotTripInfos.pickup_suburb !== false &&
                            snapshotTripInfos.pickup_suburb !== null
                            ? snapshotTripInfos.pickup_suburb.toUpperCase()
                            : "near your location"
                          : "near your location" +
                            ". Click here for more details."
                        : "near your location, click here for more details."),
                  }
                : {
                    en:
                      "You have a new delivery request " +
                      (snapshotTripInfos.pickup_suburb !== false
                        ? "from " + snapshotTripInfos.pickup_suburb !==
                          undefined
                          ? snapshotTripInfos.pickup_suburb !== undefined &&
                            snapshotTripInfos.pickup_suburb !== false &&
                            snapshotTripInfos.pickup_suburb !== null
                            ? snapshotTripInfos.pickup_suburb.toUpperCase()
                            : "near your location"
                          : "near your location" +
                              " to " +
                              snapshotTripInfos.pickup_suburb !==
                            undefined
                          ? snapshotTripInfos.pickup_suburb !== undefined &&
                            snapshotTripInfos.pickup_suburb !== false &&
                            snapshotTripInfos.pickup_suburb !== null
                            ? snapshotTripInfos.pickup_suburb.toUpperCase()
                            : "near your location"
                          : "near your location" +
                            ". Click here for more details."
                        : "near your location, click here for more details."),
                  },
              headings: /RIDE/i.test(snapshotTripInfos.ride_type)
                ? { en: "New ride request, N$" + snapshotTripInfos.fare }
                : { en: "New delivery request, N$" + snapshotTripInfos.fare },
              content_available: true,
              include_player_ids: driversSnap.pushNotif_tokens,
            };
            //logger.info(message);
            //Send
            sendPushUPNotification(message);
            //...
            resolve({ response: "staged_dispatch_successfull" });
          }
        );
      } //Request already accepted
      else {
        //! Give access to all the qualified drivers
        let checkAcceptance = {
          "ride_state_vars.isRideCompleted_driverSide": false,
          request_fp: request_fp,
        }; //?Indexed
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
                      ...originalAllDrivers_fp,
                    ]),
                  ],
                },
              };
              collectionRidesDeliveryData.updateOne(
                checkAcceptance,
                updatedAllowedSee,
                function (err, reslt) {
                  resolve({ response: "request_already_accepted" });
                }
              );
            } //Already completed
            else {
              resolve({ response: "request_already_accepted" });
            }
          });
      }
    });
}

/**
 * @func confirmDropoff_fromRider_side
 * @param resolve
 * @param dropOffMeta_bundle: contains all the necessary information about the rating (rating_score, compliments array, personal note AND REQUEST FINGERPRINT)
 * @param collectionRidesDeliveryData: rides and deliveries collection
 * @param collectionDrivers_profiles: the list of all the drivers.
 * @param channel: rabbitmq communication channel.
 * Responsible for confirming the drop off of a ride EXCLUSIVELY for the riders.
 * Tasks:
 * 1. Mark as arrived to destination.
 * 2. Mark as confirmed from the rider side
 * 3. Assign the rating
 * 4. Assign compliments (if any)
 * 5. Assign custom note (if any)
 * ! Reinforce all drop off vars in case
 */
function confirmDropoff_fromRider_side(
  dropOffMeta_bundle,
  collectionRidesDeliveryData,
  collectionDrivers_profiles,
  channel,
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
      date_dropoff: new Date(chaineDateUTC),
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
      //! Update the  driver's cached list
      new Promise((resCompute) => {
        collectionRidesDeliveryData
          .find(retrieveTrip)
          .toArray(function (err, tripData) {
            if (err) {
              resCompute(false);
            }
            //...
            if (tripData !== undefined && tripData.length > 0) {
              let driverFilter = {
                "operational_state.last_location.city":
                  tripData[0].pickup_location_infos.city,
              };

              collectionDrivers_profiles
                .find(driverFilter)
                //!.collation({ locale: "en", strength: 2 })
                .toArray(function (err, driversData) {
                  if (err) {
                    resCompute(false);
                  }
                  //...
                  if (driversData !== undefined && driversData.length > 0) {
                    //Found some drivers
                    let parentPromises = driversData.map((driverInfo) => {
                      return new Promise((resInside) => {
                        //! RABBITMQ MESSAGE
                        channel.assertQueue(
                          process.env.TRIPS_UPDATE_AFTER_BOOKING_QUEUE_NAME,
                          {
                            durable: true,
                          }
                        );
                        //Send message
                        let message = {
                          user_fingerprint: driverInfo.driver_fingerprint,
                          requestType: /scheduled/i.test(
                            tripData[0].request_type
                          )
                            ? "scheduled"
                            : tripData[0].ride_mode,
                          user_nature: "driver",
                        };

                        channel.sendToQueue(
                          process.env.TRIPS_UPDATE_AFTER_BOOKING_QUEUE_NAME,
                          Buffer.from(JSON.stringify(message)),
                          {
                            persistent: true,
                          }
                        );
                        resInside(true);
                      });
                    });
                    //...
                    Promise.all(parentPromises)
                      .then(() => {
                        resCompute(true);
                      })
                      .catch(() => {
                        resCompute(true);
                      });
                  } //No drivers  found
                  else {
                    resCompute(false);
                  }
                });
            } //No ride details
            else {
              resCompute(false);
            }
          });
      })
        .then()
        .catch();
      //..
      collectionRidesDeliveryData
        .find(retrieveTrip)
        .toArray(function (err, result) {
          if (err) {
            resolve({ response: "successfully_confirmed" });
          }
          //...
          if (result !== undefined && result.length > 0) {
            resolve({
              response: "successfully_confirmed",
              driver_fp: result[0].taxi_id,
            });
          } else {
            resolve({ response: "successfully_confirmed" });
          }
        });
    }
  );
}

/**
 * @func cancelRider_request
 * @param resolve
 * @param collectionRidesDeliveryData: list of all the rides/delivery requests
 * @param collection_cancelledRidesDeliveryData: list of all the cancelledd rides/delivery requests.
 * @param collectionDrivers_profiles: list of all the drivers
 * @param channel: rabbitmq communication channel.
 * @param requestBundle_data: object containing the request fp and the rider's fp
 * @param additionalData: contains additional data like the flag and so on.
 * Responsible for cancelling requests for riders and all the related processes.
 */
function cancelRider_request(
  requestBundle_data,
  collectionRidesDeliveryData,
  collection_cancelledRidesDeliveryData,
  collectionDrivers_profiles,
  channel,
  resolve,
  additionalData
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
        requestData[0].date_deleted = new Date(chaineDateUTC);
        //Add any additional data
        requestData[0].additionalData = additionalData;
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
                //Get the regional list of all the drivers online/offline
                new Promise((resCompute) => {
                  let driverFilter = {
                    "operational_state.last_location.city":
                      requestData[0].pickup_location_infos.city,
                  };
                  collectionDrivers_profiles
                    .find(driverFilter)
                    //!.collation({ locale: "en", strength: 2 })
                    .toArray(function (err, driversData) {
                      if (err) {
                        resCompute(false);
                      }
                      //...
                      if (driversData !== undefined && driversData.length > 0) {
                        //Found some drivers
                        let parentPromises = driversData.map((driverInfo) => {
                          return new Promise((resInside) => {
                            //! RABBITMQ MESSAGE
                            channel.assertQueue(
                              process.env.TRIPS_UPDATE_AFTER_BOOKING_QUEUE_NAME,
                              {
                                durable: true,
                              }
                            );
                            //Send message
                            let message = {
                              user_fingerprint: driverInfo.driver_fingerprint,
                              requestType: /scheduled/i.test(
                                requestData[0].request_type
                              )
                                ? "scheduled"
                                : requestData[0].ride_mode,
                              user_nature: "driver",
                            };

                            channel.sendToQueue(
                              process.env.TRIPS_UPDATE_AFTER_BOOKING_QUEUE_NAME,
                              Buffer.from(JSON.stringify(message)),
                              {
                                persistent: true,
                              }
                            );
                            resInside(true);
                          });
                        });
                        //...
                        Promise.all(parentPromises)
                          .then(() => {
                            resCompute(true);
                          })
                          .catch(() => {
                            resCompute(true);
                          });
                      } //No drivers  found
                      else {
                        resCompute(false);
                      }
                    });
                })
                  .then()
                  .catch();

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
            date: new Date(chaineDateUTC),
          });
          res(true);
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
 * @param bundleWorkingData: contains the driver_fp and the request_fp.
 * @param collectionRidesDeliveryData: list of all the requests made.
 * @param collectionGlobalEvents: hold all the random events that happened somewhere.
 * @param collectionDrivers_profiles: list of all the drivers.
 * @param collectionPassengers_profiles: list off all the riders.
 * @param channel: Rabbitmq communication channel.
 * @param resolve
 */
function acceptRequest_driver(
  bundleWorkingData,
  collectionRidesDeliveryData,
  collectionGlobalEvents,
  collectionDrivers_profiles,
  collectionPassengers_profiles,
  channel,
  resolve
) {
  resolveDate();
  //Only decline if not yet accepted by the driver
  collectionRidesDeliveryData
    .find({
      request_fp: bundleWorkingData.request_fp,
      taxi_id: false,
      /*intentional_request_decline: {
        $not: bundleWorkingData.driver_fingerprint,
      },*/
    })
    .toArray(function (err, result) {
      if (err) {
        //logger.info(err);
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
            date: new Date(chaineDateUTC),
          });
          res(true);
        }).then(
          () => {},
          () => {}
        );
        //! Get the driver's details - to fetch the car's fingerprint
        collectionDrivers_profiles
          .find({ driver_fingerprint: bundleWorkingData.driver_fingerprint })
          .toArray(function (err, driverData) {
            if (err) {
              //logger.info(err);
              resolve({ response: "unable_to_accept_request_error" });
            }
            //...
            if (driverData.length > 0) {
              //Found driver's data
              //Update the true request
              collectionRidesDeliveryData.updateOne(
                {
                  request_fp: bundleWorkingData.request_fp,
                  taxi_id: false,
                  /*intentional_request_decline: {
                    $not: bundleWorkingData.driver_fingerprint,
                  },*/
                },
                {
                  $set: {
                    taxi_id: bundleWorkingData.driver_fingerprint,
                    "ride_state_vars.isAccepted": true,
                    date_accepted: new Date(chaineDateUTC),
                    car_fingerprint:
                      driverData[0].operational_state.default_selected_car
                        .car_fingerprint,
                  },
                },
                function (err, res) {
                  if (err) {
                    //logger.info(err);
                    resolve({ response: "unable_to_accept_request_error" });
                  }
                  //Get the regional list of all the drivers online/offline
                  //! Update the  driver's cached list
                  new Promise((resCompute) => {
                    let driverFilter = {
                      "operational_state.last_location.city":
                        result[0].pickup_location_infos.city,
                    };
                    collectionDrivers_profiles
                      .find(driverFilter)
                      //!.collation({ locale: "en", strength: 2 })
                      .toArray(function (err, driversData) {
                        if (err) {
                          resCompute(false);
                        }
                        //...
                        if (
                          driversData !== undefined &&
                          driversData.length > 0
                        ) {
                          //Found some drivers
                          let parentPromises = driversData.map((driverInfo) => {
                            return new Promise((resInside) => {
                              //! RABBITMQ MESSAGE
                              channel.assertQueue(
                                process.env
                                  .TRIPS_UPDATE_AFTER_BOOKING_QUEUE_NAME,
                                {
                                  durable: true,
                                }
                              );
                              //Send message
                              let message = {
                                user_fingerprint: driverInfo.driver_fingerprint,
                                requestType: /scheduled/i.test(
                                  result[0].request_type
                                )
                                  ? "scheduled"
                                  : result[0].ride_mode,
                                user_nature: "driver",
                              };
                              channel.sendToQueue(
                                process.env
                                  .TRIPS_UPDATE_AFTER_BOOKING_QUEUE_NAME,
                                Buffer.from(JSON.stringify(message)),
                                {
                                  persistent: true,
                                }
                              );
                              resInside(true);
                            });
                          });
                          //...
                          Promise.all(parentPromises)
                            .then(() => {
                              resCompute(true);
                            })
                            .catch(() => {
                              resCompute(true);
                            });
                        } //No drivers  found
                        else {
                          resCompute(false);
                        }
                      });
                  })
                    .then()
                    .catch();

                  //?Notify the cllient
                  //Send the push notifications - FOR Passengers
                  new Promise((resSendNotif) => {
                    //? Get the rider's details
                    collectionPassengers_profiles
                      .find({
                        user_fingerprint: result[0].client_id,
                      })
                      .toArray(function (err, ridersDetails) {
                        if (err) {
                          resSendNotif(false);
                        }
                        //...
                        if (
                          ridersDetails.length > 0 &&
                          ridersDetails[0].user_fingerprint !== undefined &&
                          ridersDetails[0].pushnotif_token !== null &&
                          ridersDetails[0].pushnotif_token !== undefined &&
                          ridersDetails[0].pushnotif_token.userId !== undefined
                        ) {
                          let message = {
                            app_id: process.env.RIDERS_APP_ID_ONESIGNAL,
                            android_channel_id:
                              process.env
                                .RIDERS_ONESIGNAL_CHANNEL_ACCEPTTEDD_REQUEST, //Ride or delivery channel
                            priority: 10,
                            contents: {
                              en: "We've found a driver for your request. click here for more.",
                            },
                            headings: { en: "Request accepted" },
                            content_available: true,
                            include_player_ids: [
                              String(ridersDetails[0].pushnotif_token.userId),
                            ],
                          };
                          //Send
                          sendPushUPNotification(message);
                          resSendNotif(false);
                        } else {
                          resSendNotif(false);
                        }
                      });
                  }).then(
                    () => {},
                    () => {}
                  );
                  //? Update the accepted rides brief list in the driver's profile
                  new Promise((resUpdateDriverProfile) => {
                    //Get request infos
                    collectionRidesDeliveryData
                      .find({ request_fp: bundleWorkingData.request_fp })
                      .toArray(function (err, requestPrevData) {
                        if (err) {
                          resUpdateDriverProfile(false);
                        }
                        //...
                        if (
                          requestPrevData.length > 0 &&
                          requestPrevData[0].request_fp !== undefined &&
                          requestPrevData[0].request_fp !== null
                        ) {
                          //?Get the previous data or initialize it if empty
                          let prevAcceptedData =
                            driverData.accepted_requests_infos !== undefined &&
                            driverData.accepted_requests_infos
                              .total_passengers_number !== undefined &&
                            driverData.accepted_requests_infos
                              .total_passengers_number !== null &&
                            driverData.accepted_requests_infos
                              .total_passengers_number !== undefined &&
                            driverData.accepted_requests_infos
                              .total_passengers_number !== null
                              ? driverData.accepted_requests_infos
                              : {
                                  total_passengers_number: 0,
                                  requests_fingerprints: [],
                                };
                          //...
                          //? Update with new request
                          prevAcceptedData.total_passengers_number += parseInt(
                            requestPrevData[0].passengers_number
                          );
                          prevAcceptedData.requests_fingerprints.push(
                            requestPrevData[0].request_fp
                          );
                          //...
                          collectionDrivers_profiles.updateOne(
                            {
                              driver_fingerprint:
                                bundleWorkingData.driver_fingerprint,
                            },
                            {
                              $set: {
                                "operational_state.accepted_requests_infos":
                                  prevAcceptedData,
                                date_updated: chaineDateUTC,
                              },
                            },
                            function (err, reslt) {
                              if (err) {
                                resUpdateDriverProfile(false);
                              }
                              //...
                              resUpdateDriverProfile(true);
                            }
                          );
                        } //Strange - no request found
                        else {
                          resUpdateDriverProfile(true);
                        }
                      });
                  })
                    .then(
                      () => {},
                      () => {}
                    )
                    .catch((error) => {
                      //logger.info(error);
                    });

                  //DONE
                  resolve({
                    response: "successfully_accepted",
                    rider_fp: result[0].client_id,
                  });
                }
              );
            } //?Very strange, could not find the driver's information
            else {
              resolve({ response: "unable_to_accept_request_error" });
            }
          });
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
 * @param collectionPassengers_profiles: list of all the drivers.
 * @param collectionDrivers_profiles: the liist of all the drivers.
 * @param channel: rabbitmq communication channel.
 * @param resolve
 */
function cancelRequest_driver(
  bundleWorkingData,
  collectionRidesDeliveryData,
  collectionGlobalEvents,
  collectionPassengers_profiles,
  collectionDrivers_profiles,
  channel,
  resolve
) {
  resolveDate();
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
        let tmpRefDate = new Date(chaineDateUTC);
        //! Check if the driver did not cancel more than MAXIMUM_CANCELLATION_DRIVER_REQUESTS_LIMIT requests today
        collectionGlobalEvents
          .find({
            event_name: "driver_cancelling_request",
            driver_fingerprint: bundleWorkingData.driver_fingerprint,
            date: {
              $gte: new Date(
                `${tmpRefDate.getFullYear()}-${
                  tmpRefDate.getMonth() + 1
                }-${tmpRefDate.getDate()} 00:00:00.00`
              ),
              $lte: new Date(
                `${tmpRefDate.getFullYear()}-${
                  tmpRefDate.getMonth() + 1
                }-${tmpRefDate.getDate()} 23:59:59.59`
              ),
            },
          })
          .toArray(function (err, resultCancelledRequests) {
            if (err) {
              logger.warn(error);
              resolve({ response: "unable_to_cancel_request_error" });
            }
            logger.info(resultCancelledRequests);
            logger.info(resultCancelledRequests.length);
            logger.info(
              resultCancelledRequests !== undefined &&
                resultCancelledRequests.length <
                  parseInt(
                    process.env.MAXIMUM_CANCELLATION_DRIVER_REQUESTS_LIMIT
                  )
            );
            //...
            if (
              resultCancelledRequests !== undefined &&
              resultCancelledRequests.length <
                parseInt(process.env.MAXIMUM_CANCELLATION_DRIVER_REQUESTS_LIMIT)
            ) {
              //Can cancel
              //The driver requesting for the cancellation is the one who's currently associated to the request - proceed to the cancellation
              //Save the cancellation event
              new Promise((res) => {
                collectionGlobalEvents.insertOne(
                  {
                    event_name: "driver_cancelling_request",
                    request_fp: bundleWorkingData.request_fp,
                    driver_fingerprint: bundleWorkingData.driver_fingerprint,
                    date: new Date(chaineDateUTC),
                  },
                  function (err, resltInsert) {
                    res(true);
                  }
                );
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
                    car_fingerprint: null,
                  },
                },
                function (err, res) {
                  if (err) {
                    resolve({ response: "unable_to_cancel_request_error" });
                  }
                  //Send the push notifications - FOR DRIVERS
                  new Promise((resNotify) => {
                    //! Get all the drivers
                    let driverFilter = {
                      "operational_state.status": { $in: ["online"] },
                      "operational_state.last_location.city":
                        result[0].pickup_location_infos.city,
                      /*"operational_state.last_location.country": snapshotTripInfos.country,
                operation_clearances: snapshotTripInfos.ride_type,*/
                      //Filter the drivers based on the vehicle type if provided
                      "operational_state.default_selected_car.vehicle_type":
                        result[0].carTypeSelected,
                    };
                    //..
                    collectionDrivers_profiles
                      .find(driverFilter)
                      //!.collation({ locale: "en", strength: 2 })
                      .toArray(function (err, driversProfiles) {
                        //Filter the drivers based on their car's maximum capacity (the amount of passengers it can handle)
                        //They can receive 3 additional requests on top of the limit of sits in their selected cars.
                        //! DISBALE PASSENGERS CHECK
                        /*driversProfiles = driversProfiles.filter(
                    (dData) =>
                      dData.operational_state.accepted_requests_infos === null ||
                      dData.operational_state.accepted_requests_infos
                        .total_passengers_number <=
                        dData.operational_state.default_selected_car.max_passengers + 3 ||
                      dData.operational_state.accepted_requests_infos === undefined ||
                      dData.operational_state.accepted_requests_infos === null ||
                      dData.operational_state.accepted_requests_infos
                        .total_passengers_number === undefined ||
                      dData.operational_state.accepted_requests_infos
                        .total_passengers_number === null
                  );*/

                        //...Register the drivers fp so that thei can see tne requests
                        let driversPushNotif_token = driversProfiles.map(
                          (data) => {
                            if (
                              /online/i.test(data.operational_state.status) &&
                              data.driver_fingerprint.trim() !==
                                bundleWorkingData.driver_fingerprint.trim()
                            ) {
                              return data.operational_state
                                .push_notification_token !== null &&
                                data.operational_state
                                  .push_notification_token !== undefined
                                ? data.operational_state.push_notification_token
                                    .userId
                                : null;
                            } else {
                              return null; //Only notify the drivers that are online.
                            }
                          }
                        ); //Push notification token
                        //....
                        let message = {
                          app_id: process.env.DRIVERS_APP_ID_ONESIGNAL,
                          android_channel_id: /RIDE/i.test(result[0].ride_mode)
                            ? process.env
                                .DRIVERS_ONESIGNAL_CHANNEL_NEW_NOTIFICATION
                            : process.env
                                .DRIVERS_ONESIGNAL_CHANNEL_NEW_NOTIFICATION, //Ride or delivery channel
                          priority: 10,
                          contents: /RIDE/i.test(result[0].ride_mode)
                            ? {
                                en:
                                  "You have a new ride request " +
                                  (result[0].pickup_location_infos.suburb !==
                                  false
                                    ? "from " +
                                        result[0].pickup_location_infos
                                          .suburb !==
                                        undefined &&
                                      result[0].pickup_location_infos.suburb !==
                                        false &&
                                      result[0].pickup_location_infos.suburb !==
                                        null
                                      ? result[0].pickup_location_infos.suburb.toUpperCase()
                                      : "near your location" +
                                          " to " +
                                          result[0].pickup_location_infos
                                            .suburb !==
                                          undefined &&
                                        result[0].pickup_location_infos
                                          .suburb !== false &&
                                        result[0].pickup_location_infos
                                          .suburb !== null
                                      ? result[0].pickup_location_infos.suburb.toUpperCase()
                                      : "near your location" +
                                        ". Click here for more details."
                                    : "near your location, click here for more details."),
                              }
                            : {
                                en:
                                  "You have a new delivery request " +
                                  (result[0].pickup_location_infos.suburb !==
                                  false
                                    ? "from " +
                                        result[0].pickup_location_infos
                                          .suburb !==
                                        undefined &&
                                      result[0].pickup_location_infos.suburb !==
                                        false &&
                                      result[0].pickup_location_infos.suburb !==
                                        null
                                      ? result[0].pickup_location_infos.suburb.toUpperCase()
                                      : "near your location" +
                                          " to " +
                                          result[0].pickup_location_infos
                                            .suburb !==
                                          undefined &&
                                        result[0].pickup_location_infos
                                          .suburb !== false &&
                                        result[0].pickup_location_infos
                                          .suburb !== null
                                      ? result[0].pickup_location_infos.suburb.toUpperCase()
                                      : "near your location" +
                                        ". Click here for more details."
                                    : "near your location, click here for more details."),
                              },
                          headings: /RIDE/i.test(result[0].ride_mode)
                            ? { en: "New ride request, N$" + result[0].fare }
                            : {
                                en: "New delivery request, N$" + result[0].fare,
                              },
                          content_available: true,
                          include_player_ids: driversPushNotif_token,
                        };
                        //Send
                        sendPushUPNotification(message);
                        resNotify(true);
                      });
                  })
                    .then()
                    .catch();

                  //! Update the  driver's cached list
                  new Promise((resCompute) => {
                    let driverFilter = {
                      "operational_state.last_location.city":
                        result[0].pickup_location_infos.city,
                    };

                    collectionDrivers_profiles
                      .find(driverFilter)
                      //!.collation({ locale: "en", strength: 2 })
                      .toArray(function (err, driversData) {
                        if (err) {
                          resCompute(false);
                        }
                        //...
                        if (
                          driversData !== undefined &&
                          driversData.length > 0
                        ) {
                          //Found some drivers
                          let parentPromises = driversData.map((driverInfo) => {
                            return new Promise((resInside) => {
                              //! RABBITMQ MESSAGE
                              channel.assertQueue(
                                process.env
                                  .TRIPS_UPDATE_AFTER_BOOKING_QUEUE_NAME,
                                {
                                  durable: true,
                                }
                              );
                              //Send message
                              let message = {
                                user_fingerprint: driverInfo.driver_fingerprint,
                                requestType: /scheduled/i.test(
                                  result[0].request_type
                                )
                                  ? "scheduled"
                                  : result[0].ride_mode,
                                user_nature: "driver",
                              };

                              channel.sendToQueue(
                                process.env
                                  .TRIPS_UPDATE_AFTER_BOOKING_QUEUE_NAME,
                                Buffer.from(JSON.stringify(message)),
                                {
                                  persistent: true,
                                }
                              );
                              resInside(true);
                            });
                          });
                          //...
                          Promise.all(parentPromises)
                            .then(() => {
                              resCompute(true);
                            })
                            .catch(() => {
                              resCompute(true);
                            });
                        } //No drivers  found
                        else {
                          resCompute(false);
                        }
                      });
                  })
                    .then()
                    .catch();
                  //? Update the accepted rides brief list in the driver's profile
                  new Promise((resUpdateDriverProfile) => {
                    //! Get the driver's details - to fetch the car's fingerprint
                    collectionDrivers_profiles
                      .find({
                        driver_fingerprint:
                          bundleWorkingData.driver_fingerprint,
                      })
                      .toArray(function (err, driverData) {
                        if (err) {
                          resUpdateDriverProfile(false);
                        }
                        //...
                        if (driverData.length > 0) {
                          driverData = driverData[0];
                          //Get request infos
                          collectionRidesDeliveryData
                            .find({ request_fp: bundleWorkingData.request_fp })
                            .toArray(function (err, requestPrevData) {
                              if (err) {
                                resUpdateDriverProfile(false);
                              }
                              //...
                              if (
                                requestPrevData !== undefined &&
                                requestPrevData.length > 0 &&
                                requestPrevData[0].request_fp !== undefined &&
                                requestPrevData[0].request_fp !== null
                              ) {
                                //?Get the previous data or initialize it if empty
                                let prevAcceptedData =
                                  driverData.accepted_requests_infos !==
                                    undefined &&
                                  driverData.accepted_requests_infos
                                    .total_passengers_number !== undefined &&
                                  driverData.accepted_requests_infos
                                    .total_passengers_number !== null &&
                                  driverData.accepted_requests_infos
                                    .total_passengers_number !== undefined &&
                                  driverData.accepted_requests_infos
                                    .total_passengers_number !== null
                                    ? driverData.accepted_requests_infos
                                    : {
                                        total_passengers_number: 0,
                                        requests_fingerprints: [],
                                      };
                                //...
                                //? Update with new request - remove current request data

                                prevAcceptedData.total_passengers_number -=
                                  parseInt(
                                    driverData.accepted_requests_infos !==
                                      undefined &&
                                      driverData.accepted_requests_infos !==
                                        null &&
                                      driverData.accepted_requests_infos
                                        .total_passengers_number !==
                                        undefined &&
                                      driverData.accepted_requests_infos
                                        .total_passengers_number > 0
                                      ? requestPrevData[0].passengers_number
                                      : 0
                                  ); //! DO not remove if the total number of passengers was zero already.
                                prevAcceptedData.requests_fingerprints =
                                  prevAcceptedData.requests_fingerprints
                                    .length > 0
                                    ? prevAcceptedData.requests_fingerprints.filter(
                                        (fps) =>
                                          fps !== bundleWorkingData.request_fp
                                      )
                                    : {}; //! Do not filter out the current request_fp if it was already empty.
                                //...
                                collectionDrivers_profiles.updateOne(
                                  {
                                    driver_fingerprint:
                                      bundleWorkingData.driver_fingerprint,
                                  },
                                  {
                                    $set: {
                                      "operational_state.accepted_requests_infos":
                                        prevAcceptedData,
                                      date_updated: chaineDateUTC,
                                    },
                                  },
                                  function (err, reslt) {
                                    if (err) {
                                      resUpdateDriverProfile(false);
                                    }
                                    //...
                                    resUpdateDriverProfile(true);
                                  }
                                );

                                //?Notify the cllient
                                //Send the push notifications - FOR Passengers
                                new Promise((resSendNotif) => {
                                  //? Get the rider's details
                                  collectionPassengers_profiles
                                    .find({
                                      user_fingerprint:
                                        requestPrevData[0].client_id,
                                    })
                                    .toArray(function (err, ridersDetails) {
                                      if (err) {
                                        resSendNotif(false);
                                      }
                                      //...
                                      if (
                                        ridersDetails.length > 0 &&
                                        ridersDetails[0].user_fingerprint !==
                                          undefined &&
                                        ridersDetails[0].pushnotif_token !==
                                          null &&
                                        ridersDetails[0].pushnotif_token !==
                                          undefined &&
                                        ridersDetails[0].pushnotif_token
                                          .userId !== undefined
                                      ) {
                                        let message = {
                                          app_id:
                                            process.env.RIDERS_APP_ID_ONESIGNAL,
                                          android_channel_id:
                                            process.env
                                              .RIDERS_ONESIGNAL_CHANNEL_ACCEPTTEDD_REQUEST, //Ride or delivery channel
                                          priority: 10,
                                          contents: {
                                            en: "Your previous driver has cancelled the trip, we're looking for a new one.",
                                          },
                                          headings: {
                                            en: "Finding you a ride",
                                          },
                                          content_available: true,
                                          include_player_ids: [
                                            String(
                                              ridersDetails[0].pushnotif_token
                                                .userId
                                            ),
                                          ],
                                        };
                                        //Send
                                        sendPushUPNotification(message);
                                        resSendNotif(false);
                                      } else {
                                        resSendNotif(false);
                                      }
                                    });
                                }).then(
                                  () => {},
                                  () => {}
                                );
                              } //Strange - no request found
                              else {
                                resUpdateDriverProfile(true);
                              }
                            });
                        } //No driver found
                        else {
                          resUpdateDriverProfile(false);
                        }
                      });
                  })
                    .then(
                      () => {},
                      () => {}
                    )
                    .catch((error) => {
                      //logger.info(error);
                    });
                  //DONE
                  resolve({
                    response: "successfully_cancelled",
                    rider_fp: result[0].client_id,
                  });
                }
              );
            } //!Has exceeded the daily cancellation limit
            else {
              resolve({
                response:
                  "unable_to_cancel_request_error_daily_cancellation_limit_exceeded",
                limit: process.env.MAXIMUM_CANCELLATION_DRIVER_REQUESTS_LIMIT,
              });
            }
          });
      } //abort the cancelling
      else {
        resolve({ response: "unable_to_cancel_request_not_owned" });
      }
    });
}

/**
 * @func confirmPickupRequest_driver
 * Responsible for confirming pickup for any request from the driver app, If and only if the request was accepted by the driver who's requesting for the the pickup confirmation.
 * @param collectionRidesDeliveryData: list of all the requests made.
 * @param collectionGlobalEvents: hold all the random events that happened somewhere.
 * @param bundleWorkingData: contains the driver_fp and the request_fp.
 * @param resolve
 */
function confirmPickupRequest_driver(
  bundleWorkingData,
  collectionRidesDeliveryData,
  collectionGlobalEvents,
  collectionDrivers_profiles,
  channel,
  resolve
) {
  resolveDate();
  //Only confirm pickup if not yet accepted by the driver
  collectionRidesDeliveryData
    .find({
      request_fp: bundleWorkingData.request_fp,
      taxi_id: bundleWorkingData.driver_fingerprint,
    })
    //!.collation({ locale: "en", strength: 2 })
    .toArray(function (err, result) {
      if (err) {
        resolve({ response: "unable_to_confirm_pickup_request_error" });
      }
      //...
      if (result.length > 0) {
        //The driver requesting for the confirm pickup is the one who's currently associated to the request - proceed to the pickup confirmation.
        //Save the pickup confirmation event
        new Promise((res) => {
          collectionGlobalEvents.insertOne({
            event_name: "driver_confirm_pickup_request",
            request_fp: bundleWorkingData.request_fp,
            driver_fingerprint: bundleWorkingData.driver_fingerprint,
            date: new Date(chaineDateUTC),
          });
          res(true);
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
              taxi_id: bundleWorkingData.driver_fingerprint,
              date_pickup: new Date(chaineDateUTC),
              "ride_state_vars.isAccepted": true,
              "ride_state_vars.inRideToDestination": true,
            },
          },
          function (err, res) {
            if (err) {
              resolve({ response: "unable_to_confirm_pickup_request_error" });
            }
            //! Update the  driver's cached list
            new Promise((resCompute) => {
              let driverFilter = {
                "operational_state.last_location.city":
                  result[0].pickup_location_infos.city,
              };

              collectionDrivers_profiles
                .find(driverFilter)
                //!.collation({ locale: "en", strength: 2 })
                .toArray(function (err, driversData) {
                  if (err) {
                    resCompute(false);
                  }
                  //...
                  if (driversData !== undefined && driversData.length > 0) {
                    //Found some drivers
                    let parentPromises = driversData.map((driverInfo) => {
                      return new Promise((resInside) => {
                        //! RABBITMQ MESSAGE
                        channel.assertQueue(
                          process.env.TRIPS_UPDATE_AFTER_BOOKING_QUEUE_NAME,
                          {
                            durable: true,
                          }
                        );
                        //Send message
                        let message = {
                          user_fingerprint: driverInfo.driver_fingerprint,
                          requestType: /scheduled/i.test(result[0].request_type)
                            ? "scheduled"
                            : result[0].ride_mode,
                          user_nature: "driver",
                        };

                        channel.sendToQueue(
                          process.env.TRIPS_UPDATE_AFTER_BOOKING_QUEUE_NAME,
                          Buffer.from(JSON.stringify(message)),
                          {
                            persistent: true,
                          }
                        );
                        resInside(true);
                      });
                    });
                    //...
                    Promise.all(parentPromises)
                      .then(() => {
                        resCompute(true);
                      })
                      .catch(() => {
                        resCompute(true);
                      });
                  } //No drivers  found
                  else {
                    resCompute(false);
                  }
                });
            })
              .then()
              .catch();
            //DONE
            resolve({
              response: "successfully_confirmed_pickup",
              rider_fp: result[0].client_id,
            });
          }
        );
      } //abort the pickup confirmation
      else {
        resolve({ response: "unable_to_confirm_pickup_request_not_owned" });
      }
    });
}

/**
 * @func confirmDropoffRequest_driver
 * Responsible for confirming dropoff for any request from the driver app, If and only if the request was accepted by the driver who's requesting for the the dropoff confirmation.
 * @param collectionRidesDeliveryData: list of all the requests made.
 * @param collectionGlobalEvents: hold all the random events that happened somewhere.
 * @param bundleWorkingData: contains the driver_fp and the request_fp.
 * @param collectionPassengers_profiles: list of all the passengers.
 * @param collectionDrivers_profiles: the list of all the drivers.
 * @param channel: rabbitmq communication
 * @param resolve
 */
function confirmDropoffRequest_driver(
  bundleWorkingData,
  collectionRidesDeliveryData,
  collectionGlobalEvents,
  collectionPassengers_profiles,
  collectionDrivers_profiles,
  channel,
  resolve
) {
  resolveDate();
  //Only confirm pickup if not yet accepted by the driver
  collectionRidesDeliveryData
    .find({
      request_fp: bundleWorkingData.request_fp,
      taxi_id: bundleWorkingData.driver_fingerprint,
    })
    .toArray(function (err, result) {
      if (err) {
        resolve({ response: "unable_to_confirm_dropoff_request_error" });
      }
      //...
      if (result.length > 0) {
        //The driver requesting for the confirm dropoff is the one who's currently associated to the request - proceed to the dropoff confirmation.
        //Save the dropoff confirmation event
        new Promise((res) => {
          collectionGlobalEvents.insertOne({
            event_name: "driver_confirm_dropoff_request",
            request_fp: bundleWorkingData.request_fp,
            driver_fingerprint: bundleWorkingData.driver_fingerprint,
            date: new Date(chaineDateUTC),
          });
          res(true);
        })
          .then(() => {})
          .catch();
        //Update the true request
        collectionRidesDeliveryData.updateOne(
          {
            request_fp: bundleWorkingData.request_fp,
            taxi_id: bundleWorkingData.driver_fingerprint,
          },
          {
            $set: {
              taxi_id: bundleWorkingData.driver_fingerprint,
              date_dropoff: new Date(chaineDateUTC),
              "ride_state_vars.isAccepted": true,
              "ride_state_vars.inRideToDestination": true,
              "ride_state_vars.isRideCompleted_driverSide": true,
            },
          },
          function (err, res) {
            if (err) {
              resolve({ response: "unable_to_confirm_dropoff_request_error" });
            }
            //! Update the  driver's cached list
            new Promise((resCompute) => {
              let driverFilter = {
                "operational_state.last_location.city":
                  result[0].pickup_location_infos.city,
              };

              collectionDrivers_profiles
                .find(driverFilter)
                //!.collation({ locale: "en", strength: 2 })
                .toArray(function (err, driversData) {
                  if (err) {
                    resCompute(false);
                  }
                  //...
                  if (driversData !== undefined && driversData.length > 0) {
                    //Found some drivers
                    let parentPromises = driversData.map((driverInfo) => {
                      return new Promise((resInside) => {
                        //! RABBITMQ MESSAGE
                        channel.assertQueue(
                          process.env.TRIPS_UPDATE_AFTER_BOOKING_QUEUE_NAME,
                          {
                            durable: true,
                          }
                        );
                        //Send message
                        let message = {
                          user_fingerprint: driverInfo.driver_fingerprint,
                          requestType: /scheduled/i.test(result[0].request_type)
                            ? "scheduled"
                            : result[0].ride_mode,
                          user_nature: "driver",
                        };

                        channel.sendToQueue(
                          process.env.TRIPS_UPDATE_AFTER_BOOKING_QUEUE_NAME,
                          Buffer.from(JSON.stringify(message)),
                          {
                            persistent: true,
                          }
                        );
                        resInside(true);
                      });
                    });
                    //...
                    Promise.all(parentPromises)
                      .then(() => {
                        resCompute(true);
                      })
                      .catch(() => {
                        resCompute(true);
                      });
                  } //No drivers  found
                  else {
                    resCompute(false);
                  }
                });
            })
              .then()
              .catch();
            //? Update the accepted rides brief list in the driver's profile
            new Promise((resUpdateDriverProfile) => {
              //! Get the driver's details - to fetch the car's fingerprint
              collectionDrivers_profiles
                .find({
                  driver_fingerprint: bundleWorkingData.driver_fingerprint,
                })
                .toArray(function (err, driverData) {
                  if (err) {
                    resUpdateDriverProfile(false);
                  }
                  //...
                  if (driverData.length > 0) {
                    //Get request infos
                    collectionRidesDeliveryData
                      .find({ request_fp: bundleWorkingData.request_fp })
                      .toArray(function (err, requestPrevData) {
                        if (err) {
                          resUpdateDriverProfile(false);
                        }
                        //...
                        if (
                          requestPrevData !== undefined &&
                          requestPrevData.length > 0 &&
                          requestPrevData[0].request_fp !== undefined &&
                          requestPrevData[0].request_fp !== null
                        ) {
                          //?Get the previous data or initialize it if empty
                          let prevAcceptedData =
                            driverData.accepted_requests_infos !== undefined &&
                            driverData.accepted_requests_infos
                              .total_passengers_number !== undefined &&
                            driverData.accepted_requests_infos
                              .total_passengers_number !== null &&
                            driverData.accepted_requests_infos
                              .total_passengers_number !== undefined &&
                            driverData.accepted_requests_infos
                              .total_passengers_number !== null
                              ? driverData.accepted_requests_infos
                              : {
                                  total_passengers_number: 0,
                                  requests_fingerprints: [],
                                };
                          //...
                          //? Update with new request - remove current request data
                          prevAcceptedData.total_passengers_number -= parseInt(
                            driverData.accepted_requests_infos !== undefined &&
                              driverData.accepted_requests_infos !== null &&
                              driverData.accepted_requests_infos
                                .total_passengers_number !== undefined &&
                              driverData.accepted_requests_infos
                                .total_passengers_number > 0
                              ? requestPrevData[0].passengers_number
                              : 0
                          ); //! DO not remove if the total number of passengers was zero already.
                          prevAcceptedData.requests_fingerprints =
                            prevAcceptedData.requests_fingerprints.length > 0
                              ? prevAcceptedData.requests_fingerprints.filter(
                                  (fps) => fps !== bundleWorkingData.request_fp
                                )
                              : {}; //! Do not filter out the current request_fp if it was already empty.
                          //...
                          collectionDrivers_profiles.updateOne(
                            {
                              driver_fingerprint:
                                bundleWorkingData.driver_fingerprint,
                            },
                            {
                              $set: {
                                "operational_state.accepted_requests_infos":
                                  prevAcceptedData,
                                date_updated: chaineDateUTC,
                              },
                            },
                            function (err, reslt) {
                              if (err) {
                                resUpdateDriverProfile(false);
                              }
                              //...
                              resUpdateDriverProfile(true);
                            }
                          );

                          //?Notify the cllient
                          //Send the push notifications - FOR Passengers
                          new Promise((resSendNotif) => {
                            //? Get the rider's details
                            collectionPassengers_profiles
                              .find({
                                user_fingerprint: requestPrevData[0].client_id,
                              })
                              .toArray(function (err, ridersDetails) {
                                if (err) {
                                  resSendNotif(false);
                                }
                                //...
                                if (
                                  ridersDetails.length > 0 &&
                                  ridersDetails[0].user_fingerprint !==
                                    undefined &&
                                  ridersDetails[0].pushnotif_token !== null &&
                                  ridersDetails[0].pushnotif_token !==
                                    undefined &&
                                  ridersDetails[0].pushnotif_token.userId !==
                                    undefined
                                ) {
                                  let message = {
                                    app_id: process.env.RIDERS_APP_ID_ONESIGNAL,
                                    android_channel_id:
                                      process.env
                                        .RIDERS_ONESIGNAL_CHANNEL_ACCEPTTEDD_REQUEST, //Ride or delivery channel
                                    priority: 10,
                                    contents: {
                                      en: "Don't forget to confirm your drop off and rate your driver. Click here to do so.",
                                    },
                                    headings: { en: "Your trip is completed" },
                                    content_available: true,
                                    include_player_ids: [
                                      String(
                                        ridersDetails[0].pushnotif_token.userId
                                      ),
                                    ],
                                  };
                                  //Send
                                  sendPushUPNotification(message);
                                  resSendNotif(false);
                                } else {
                                  resSendNotif(false);
                                }
                              });
                          }).then(
                            () => {},
                            () => {}
                          );
                        } //Strange - no request found
                        else {
                          resUpdateDriverProfile(true);
                        }
                      });
                  } //No driver
                  else {
                    resUpdateDriverProfile(false);
                  }
                });
            })
              .then(
                () => {},
                () => {}
              )
              .catch((error) => {
                //logger.info(error);
              });
            //DONE
            resolve({
              response: "successfully_confirmed_dropoff",
              rider_fp: result[0].client_id,
            });
          }
        );
      } //abort the pickup confirmation
      else {
        resolve({ response: "unable_to_confirm_dropoff_request_not_owned" });
      }
    });
}

/**
 * @func INIT_RIDE_DELIVERY_DISPATCH_ENTRY
 * Responsible for launching the ride/delivery dispath after all preliminary checks have passed.
 * ? Some checks can be: making sure that the rider has enough funds in his/her wallet.
 * @param parsedReqest_data: clean parsed request data.
 * @param collectionDrivers_profiles: driver's collection.
 * @param collectionRidesDeliveries_data: collection of all rides/deliveries
 * @param channel: the Rqbbitmq communication channel.
 * @param resolve
 */
function INIT_RIDE_DELIVERY_DISPATCH_ENTRY(
  parsedReqest_data,
  collectionDrivers_profiles,
  collectionRidesDeliveryData,
  channel,
  resolve
) {
  //? Save the request in mongodb - EXTREMELY IMPORTANT
  let checkPrevRequest = {
    client_id: parsedReqest_data.client_id,
    "ride_state_vars.isRideCompleted_riderSide": false,
    isArrivedToDestination: false,
  };

  collectionRidesDeliveryData
    .find(checkPrevRequest)
    //!.collation({ locale: "en", strength: 2 })
    .toArray(function (err, prevRequest) {
      if (err) {
        //logger.info(err);
        resolve({ response: "Unable_to_make_the_request" });
      }
      //....
      if (
        prevRequest === undefined ||
        prevRequest === null ||
        prevRequest.length <= 0 ||
        prevRequest[0] === undefined
      ) {
        collectionRidesDeliveryData.updateOne(
          {
            client_id: parsedReqest_data.client_id,
            "ride_state_vars.isRideCompleted_riderSide": false,
            isArrivedToDestination: false,
          },
          { $set: parsedReqest_data },
          {
            upsert: true,
          },
          function (err, requestDt) {
            if (err) {
              //logger.info(err);
              resolve({ response: "Unable_to_make_the_request" });
            }

            //2. INITIATE STAGED toDrivers DISPATCH
            new Promise((resStaged) => {
              //FORM THE REQUEST SNAPSHOT
              let snapshotTripInfos = {
                user_fingerprint: parsedReqest_data.client_id,
                city: parsedReqest_data.pickup_location_infos.city,
                country: parsedReqest_data.country,
                ride_type: parsedReqest_data.ride_mode,
                request_type: parsedReqest_data.request_type,
                vehicle_type: parsedReqest_data.carTypeSelected,
                org_latitude:
                  parsedReqest_data.pickup_location_infos.coordinates.latitude,
                org_longitude:
                  parsedReqest_data.pickup_location_infos.coordinates.longitude,
                request_fp: parsedReqest_data.request_fp,
                pickup_suburb: parsedReqest_data.pickup_location_infos.suburb,
                destination_suburb: parsedReqest_data.destinationData[0].suburb,
                fare: parsedReqest_data.fare,
                passengers_number: parsedReqest_data.passengers_number,
              };

              intitiateStagedDispatch(
                snapshotTripInfos,
                collectionDrivers_profiles,
                collectionRidesDeliveryData,
                channel,
                resStaged
              );
            }).then(
              (result) => {
                //logger.info(result);
              },
              (error) => {
                //logger.info(error);
              }
            );
            //..Success - respond to the user
            resolve({ response: "successfully_requested" });
          }
        );
      } //Already have a request
      else {
        //logger.info("ALEADY HAS A REQUEST");
        resolve({ response: "already_have_a_pending_request" });
      }
    });
}

/**
 * @func getRequests_graphPreview_forDrivers
 * Responsible for getting the graph of available requests to display notification badges on the
 * driver's app to make the request finding much more simple and efficient.
 * ? Only consider the free requests.
 * ? Filter based on the car type selected (normal taxo, ebikes, etc).
 * ? Filter based on the country and city.
 * ! Do not limit based on the driver's maximum capacity.
 * ? Filter based on the operation clearances of the driver.
 * ------
 * @param driver_fingerprint: the driver's fingerprint.
 * @param collectionRidesDeliveryData: the list of all the requests.
 * @param collectionDrivers_profiles: the list of all the drivers.
 * @param resolve
 */
function getRequests_graphPreview_forDrivers(
  driver_fingerprint,
  collectionRidesDeliveryData,
  collectionDrivers_profiles,
  resolve
) {
  //? Form requests graph template
  let requestsGraph = {
    rides: 0,
    deliveries: 0,
    scheduled: 0,
  };
  //...
  //1. Get the driver's data
  collectionDrivers_profiles
    .find({ driver_fingerprint: driver_fingerprint })
    .toArray(function (err, driverData) {
      if (err) {
        resolve({
          rides: 0,
          deliveries: 0,
          scheduled: 0,
        });
      }
      //...
      if (
        driverData.length > 0 &&
        driverData[0].driver_fingerprint !== undefined &&
        driverData[0].driver_fingerprint !== null
      ) {
        //Found the ddriver's data
        try {
          //2. Isolate correct requests
          collectionRidesDeliveryData
            .find(
              /88889d088e03653169b9c18193a0b8dd329ea1e43eb0626ef9f16b5b979694a429710561a3cb3ddae/i.test(
                driver_fingerprint
              )
                ? {
                    taxi_id: false,
                    "pickup_location_infos.city":
                      driverData[0].operational_state.last_location !== null &&
                      driverData[0].operational_state.last_location.city &&
                      driverData[0].operational_state.last_location.city !==
                        undefined
                        ? driverData[0].operational_state.last_location.city
                        : "Windhoek",
                    country:
                      driverData[0].operational_state.last_location !== null &&
                      driverData[0].operational_state.last_location.country &&
                      driverData[0].operational_state.last_location.country !==
                        undefined
                        ? driverData[0].operational_state.last_location.country
                        : "Namibia",
                  }
                : {
                    taxi_id: false,
                    "pickup_location_infos.city":
                      driverData[0].operational_state.last_location !== null &&
                      driverData[0].operational_state.last_location.city &&
                      driverData[0].operational_state.last_location.city !==
                        undefined
                        ? driverData[0].operational_state.last_location.city
                        : "Windhoek",
                    country:
                      driverData[0].operational_state.last_location !== null &&
                      driverData[0].operational_state.last_location.country &&
                      driverData[0].operational_state.last_location.country !==
                        undefined
                        ? driverData[0].operational_state.last_location.country
                        : "Namibia",
                    carTypeSelected:
                      driverData[0].operational_state.default_selected_car
                        .vehicle_type,
                    ride_mode: {
                      $in: driverData[0].operation_clearances.map(
                        (clearance) =>
                          `${clearance[0].toUpperCase().trim()}${clearance
                            .substr(1)
                            .toLowerCase()
                            .trim()}`
                      ),
                    },
                    /*allowed_drivers_see: driver_fingerprint,
              intentional_request_decline: driver_fingerprint,*/
                  }
            )
            //!.collation({ locale: "en", strength: 2 })
            .toArray(function (err, filteredRequests) {
              if (err) {
                resolve({
                  rides: 0,
                  deliveries: 0,
                  scheduled: 0,
                });
              }
              //logger.info(filteredRequests);
              //...
              if (filteredRequests.length > 0) {
                //? Auto segregate rides, deliveries and scheduled rides
                let parentPromises = filteredRequests.map((requestInfo) => {
                  return new Promise((resSegregate) => {
                    if (/scheduled/i.test(requestInfo.request_type)) {
                      //Scheduled request
                      requestsGraph.scheduled += 1;
                      resSegregate(true);
                    } else if (/ride/i.test(requestInfo.ride_mode)) {
                      //Ride only - now
                      requestsGraph.rides += 1;
                      resSegregate(true);
                    } else if (/delivery/i.test(requestInfo.ride_mode)) {
                      //Delivery only -now
                      requestsGraph.deliveries += 1;
                      resSegregate(true);
                    } //Unknown request mode? -Weiird
                    else {
                      resSegregate(true);
                    }
                  });
                });
                //Done
                Promise.all(parentPromises)
                  .then(
                    (resultSegregatedRequests) => {
                      resolve(requestsGraph);
                    },
                    (error) => {
                      //logger.info(error);
                      resolve({
                        rides: 0,
                        deliveries: 0,
                        scheduled: 0,
                      });
                    }
                  )
                  .catch((error) => {
                    //logger.info(error);
                    resolve({
                      rides: 0,
                      deliveries: 0,
                      scheduled: 0,
                    });
                  });
              } //No requests
              else {
                resolve({
                  rides: 0,
                  deliveries: 0,
                  scheduled: 0,
                });
              }
            });
        } catch (error) {
          //logger.info(error);
          resolve({
            rides: 0,
            deliveries: 0,
            scheduled: 0,
          });
        }
      } //Strange - no driver's record found
      else {
        resolve({
          rides: 0,
          deliveries: 0,
          scheduled: 0,
        });
      }
    });
}

function diff_hours(dt1, dt2) {
  if (dt2 > dt1) {
    return { difference: Math.abs(dt2 - dt1) / 3600000, state: "onTime" };
  } else {
    return { difference: Math.abs(dt2 - dt1) / 3600000, state: "late" };
  }
}

/**
 * MAIN
 */
redisCluster.on("connect", function () {
  //logger.info("[*] Redis connected");
  clientMongo.connect(function (err) {
    //if (err) throw err;
    logger.info("[+] Dispatch services active.");
    const dbMongo = clientMongo.db(process.env.DB_NAME_MONGODDB);
    const collectionPassengers_profiles = dbMongo.collection(
      "passengers_profiles"
    ); //Hold the information about the riders
    const collectionRidesDeliveryData = dbMongo.collection(
      "rides_deliveries_requests"
    ); //Hold all the requests made (rides and deliveries)
    const collection_cancelledRidesDeliveryData = dbMongo.collection(
      "cancelled_rides_deliveries_requests"
    ); //Hold all the cancelled requests made (rides and deliveries)
    const collectionRelativeDistances = dbMongo.collection(
      "relative_distances_riders_drivers"
    ); //Hold the relative distances between rider and the drivers (online, same city, same country) at any given time
    const collectionRidersDriversLocation_log = dbMongo.collection(
      "historical_positioning_logs"
    ); //Hold all the location updated from the rider
    const collectionDrivers_profiles = dbMongo.collection("drivers_profiles"); //Hold all the drivers profiles
    const collectionGlobalEvents = dbMongo.collection("global_events"); //Hold all the random events that happened somewhere.
    const collectionWalletTransactions_logs = dbMongo.collection(
      "wallet_transactions_logs"
    ); //Hold the latest information about the riders topups
    //-------------
    const bodyParser = require("body-parser");
    app
      .get("/", function (req, res) {
        res.send("Dispatch services up");
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
      );

    /**
     * PARSE DATA WITHOUT DISPATCH
     * Responsible for parsing the raw data without any dispatch
     */
    app.post("/parseRequestData_withoutDispatch", function (req, res) {
      req = req.body;
      /*req = {
    actualRider: "me",
    actualRiderPhone_number: false,
    carTypeSelected: "normalTaxiEconomy",
    connectType: "ConnectMe",
    country: "Namibia",
    destinationData: {
      passenger1Destination: {
        averageGeo: 10,
        city: "Windhoek",
        coordinates: [-22.62009828325774, 17.093509613071824],
        country: "Namibia",
        location_id: 5428529857,
        location_name: "The Grove Mall",
        state: "Khomas Region",
        street: "Chasie Street",
        id: 1,
        details: "Empty",
      },
      passenger2Destination: false,
      passenger3Destination: false,
      passenger4Destination: false,
    },
    fareAmount: 45,
    isAllGoingToSameDestination: false,
    naturePickup: "PrivateLocation",
    passengersNo: 1,
    pickupData: {
      city: "Windhoek",
      coordinates: [-22.563358987828945, 17.06632928612283],
      location_name: "Best St Best Street, Windhoek West",
      street_name: null,
    },
    pickupNote: "Best Street, Windhoek West",
    receiverName_delivery: false,
    receiverPhone_delivery: false,
    rideType: "RIDE",
    timeScheduled: "now",
    paymentMethod: "CASH",
    user_fingerprint:
      "caf19f4180e98600e8e362d015c1bac8a2ac99aa086bcd8047284a7e06334b0a787a80248efe580b",
    recovered_request: true,
    request_fp:
      "6e4a228382b7d6d6b9f8361f7adf16b388fbff1f265cccb6dd464ef75d9219decfe339e19af6a3c8",
    taxi_id:
      "a5a596c422195f5012076ce530b1e5144f39f800785de85293a91505be9b68b90e5ffe84ea7d7fc0",
    date_requested: "2020-10-11T12:59:14.000Z",
    trip_simplified_id: "TAMI0q3l_oXg2",
    ride_state_vars: {
      isAccepted: true,
      inRideToDestination: true,
      isRideCompleted_driverSide: true,
      isRideCompleted_riderSide: true,
      rider_driverRating: "5",
    },
    isArrivedToDestination: true,
    date_dropoff: "2020-10-11T12:59:27.000Z",
    date_pickup: "2020-10-11T12:59:27.000Z",
    date_accepted: "2020-10-11T12:59:27.000Z",
    flag: "here5",
    car_fingerprint:
      "7df7fdfd528c258a1a6da994941d1d5ca1e8a0c3452f3198d0725d8cf432e3ab2c325232df92f2af",
  };*/
      //...
      if (req.request_fp !== undefined) {
        //is present
        new Promise((resParse) => {
          parseRequestData(req, resParse);
        })
          .then(
            (result) => {
              res.send(result);
            },
            (error) => {
              //logger.info(error);
              res.send({ message: "Error parsing data", flag: error });
            }
          )
          .catch((error) => {
            //logger.info(error);
            res.send({ message: "Error parsing data", flag: error });
          });
      } //No valid data received
      else {
        res.send({ message: "No valid data received" });
      }
    });

    /**
     * REQUESTS GRAPH ASSEMBLER
     * Responsible for getting the requests graphs to help the drivers selectedd the correct tab easily.
     */
    app.get("/getRequests_graphNumbers", function (req, res) {
      new Promise((resMAIN) => {
        resolveDate();
        let params = urlParser.parse(req.url, true);
        req = params.query;

        if (req.driver_fingerprint !== undefined) {
          let redisKey = `requestsGraph-${req.driver_fingerprint}`;
          //OK
          redisGet(redisKey).then(
            (resp) => {
              if (resp !== null) {
                try {
                  //logger.info("cached resullts found!");
                  //? Rehyddrate the cached results
                  new Promise((res0) => {
                    getRequests_graphPreview_forDrivers(
                      req.driver_fingerprint,
                      collectionRidesDeliveryData,
                      collectionDrivers_profiles,
                      res0
                    );
                  })
                    .then(
                      (result) => {
                        redisCluster.setex(
                          redisKey,
                          process.env.REDIS_EXPIRATION_5MIN * 6,
                          JSON.stringify(result)
                        );
                      },
                      (error) => {
                        //logger.info(error);
                        redisCluster.setex(
                          redisKey,
                          process.env.REDIS_EXPIRATION_5MIN * 6,
                          JSON.stringify(result)
                        );
                      }
                    )
                    .catch((error) => {
                      //logger.info(error);
                      redisCluster.setex(
                        redisKey,
                        process.env.REDIS_EXPIRATION_5MIN * 6,
                        JSON.stringify(result)
                      );
                    });
                  //...
                  resp = JSON.parse(resp);
                  //...Return the cached results quickly
                  resMAIN(resp);
                } catch (error) {
                  //logger.info(error);
                  new Promise((res0) => {
                    getRequests_graphPreview_forDrivers(
                      req.driver_fingerprint,
                      collectionRidesDeliveryData,
                      collectionDrivers_profiles,
                      res0
                    );
                  })
                    .then(
                      (result) => {
                        redisCluster.setex(
                          redisKey,
                          process.env.REDIS_EXPIRATION_5MIN * 6,
                          JSON.stringify(result)
                        );
                        resMAIN(result);
                      },
                      (error) => {
                        //logger.info(error);
                        redisCluster.setex(
                          redisKey,
                          process.env.REDIS_EXPIRATION_5MIN * 6,
                          JSON.stringify(result)
                        );
                        resMAIN({
                          rides: 0,
                          deliveries: 0,
                          scheduled: 0,
                        });
                      }
                    )
                    .catch((error) => {
                      //logger.info(error);
                      redisCluster.setex(
                        redisKey,
                        process.env.REDIS_EXPIRATION_5MIN * 6,
                        JSON.stringify(result)
                      );
                      resMAIN({ rides: 0, deliveries: 0, scheduled: 0 });
                    });
                }
              } //No cached data yet
              else {
                new Promise((res0) => {
                  getRequests_graphPreview_forDrivers(
                    req.driver_fingerprint,
                    collectionRidesDeliveryData,
                    collectionDrivers_profiles,
                    res0
                  );
                })
                  .then(
                    (result) => {
                      redisCluster.setex(
                        redisKey,
                        process.env.REDIS_EXPIRATION_5MIN * 6,
                        JSON.stringify(result)
                      );
                      resMAIN(result);
                    },
                    (error) => {
                      //logger.info(error);
                      redisCluster.setex(
                        redisKey,
                        process.env.REDIS_EXPIRATION_5MIN * 6,
                        JSON.stringify(result)
                      );
                      resMAIN({ rides: 0, deliveries: 0, scheduled: 0 });
                    }
                  )
                  .catch((error) => {
                    //logger.info(error);
                    redisCluster.setex(
                      redisKey,
                      process.env.REDIS_EXPIRATION_5MIN * 6,
                      JSON.stringify(result)
                    );
                    resMAIN({ rides: 0, deliveries: 0, scheduled: 0 });
                  });
              }
            },
            (error) => {
              //logger.info(error);
              new Promise((res0) => {
                getRequests_graphPreview_forDrivers(
                  req.driver_fingerprint,
                  collectionRidesDeliveryData,
                  collectionDrivers_profiles,
                  res0
                );
              })
                .then(
                  (result) => {
                    redisCluster.setex(
                      redisKey,
                      process.env.REDIS_EXPIRATION_5MIN * 6,
                      JSON.stringify(result)
                    );
                    resMAIN(result);
                  },
                  (error) => {
                    //logger.info(error);
                    redisCluster.setex(
                      redisKey,
                      process.env.REDIS_EXPIRATION_5MIN * 6,
                      JSON.stringify(result)
                    );
                    resMAIN({ rides: 0, deliveries: 0, scheduled: 0 });
                  }
                )
                .catch((error) => {
                  //logger.info(error);
                  redisCluster.setex(
                    redisKey,
                    process.env.REDIS_EXPIRATION_5MIN * 6,
                    JSON.stringify(result)
                  );
                  resMAIN({ rides: 0, deliveries: 0, scheduled: 0 });
                });
            }
          );
        } //Invalid params
        else {
          resMAIN({ rides: 0, deliveries: 0, scheduled: 0 });
        }
      })
        .then((result) => {
          res.send(result);
        })
        .catch((error) => {
          //logger.info(error);
          resMAIN({ rides: 0, deliveries: 0, scheduled: 0 });
        });
    });

    /**
     * RIDES OR DELIVERY DECOUPLED DISPATCHER
     * Responsible for redispatching already parsed requests.
     * @param requestStructured: already parsed request coming straight from Mongo
     */
    app.post("/redispatcherAlreadyParsedRequests", function (req, res) {
      req = req.body;
      new Promise((resInit) => {
        INIT_RIDE_DELIVERY_DISPATCH_ENTRY(
          req,
          collectionDrivers_profiles,
          collectionRidesDeliveryData,
          resInit
        );
      }).then(
        (resultDispatch) => {
          //...
          res.send(resultDispatch);
        },
        (error) => {
          //logger.info(error);
          res.send({
            response: "Unable_to_redispatch_the_request",
          });
        }
      );
    });

    /**
     * @func ucFirst
     * Responsible to uppercase only the first character and lowercase the rest.
     * @param stringData: the string to be processed.
     */
    function ucFirst(stringData) {
      try {
        return `${stringData[0].toUpperCase()}${stringData.substr(1).toLowerCase()}`;
      } catch (error) {
        //logger.info(error);
        return stringData;
      }
    }

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
        carTypeSelected: "normalTaxiEconomy",
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
        fareAmount: 80,
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
        timeScheduled: "immediate",
        paymentMethod: "CASH",
        user_fingerprint:
          "5b29bb1b9ac69d884f13fd4be2badcd22b72b98a69189bfab806dcf7c5f5541b6cbe8087cf60c791",
      };
      req = testData;*/
      //...
      if (req.user_fingerprint !== undefined && req.user_fingerprint !== null) {
        //1. CHECK THAT THIS RIDER DOESN'T ALREADY HAVE AN ACTIVE RIDE/DELIVERY
        //Request is considered as completed when the rider has submited a rating.
        let checkPrevRequest = {
          client_id: req.user_fingerprint,
          isArrivedToDestination: false,
        }; //?Indexed
        collectionRidesDeliveryData
          .find(checkPrevRequest)
          .toArray(function (err, prevRequest) {
            if (
              prevRequest === undefined ||
              prevRequest === null ||
              prevRequest.length <= 0 ||
              prevRequest[0] === undefined
            ) {
              //No previous pending request - MAKE REQUEST VALID
              //Parse the data
              new Promise((res) => {
                parseRequestData(req, res);
              }).then(
                (result) => {
                  let parsedRequest = result;
                  if (result !== false) {
                    //! IF WALLET SELECTED - CHECK THE BALANCE, it should be >= to the trip fare, else ERROR_UNSIFFICIENT_FUNDS
                    if (/wallet/i.test(result.payment_method)) {
                      //? WALLET PAYMENT METHOD
                      let url = `
                  ${process.env.LOCAL_URL}:${process.env.ACCOUNTS_SERVICE_PORT}/getRiders_walletInfos?user_fingerprint=${req.user_fingerprint}&mode=total&avoidCached_data=true
                  `;
                      requestAPI(url, function (error, response, body) {
                        if (error === null) {
                          try {
                            body = JSON.parse(body);
                            if (body.total !== undefined) {
                              /*logger.info(
                                parseFloat(result.fare),
                                parseFloat(body.total)
                              );*/
                              if (
                                parseFloat(result.fare) <=
                                parseFloat(body.total)
                              ) {
                                //? HAS ENOUGH MONEY IN THE WALLET
                                /*logger.info(
                                  "Has enough funds in the wallet"
                                );*/
                                new Promise((resInit) => {
                                  INIT_RIDE_DELIVERY_DISPATCH_ENTRY(
                                    result,
                                    collectionDrivers_profiles,
                                    collectionRidesDeliveryData,
                                    channel,
                                    resInit
                                  );
                                }).then(
                                  (resultDispatch) => {
                                    //! RABBITMQ MESSAGE
                                    channel.assertQueue(
                                      process.env
                                        .TRIPS_UPDATE_AFTER_BOOKING_QUEUE_NAME,
                                      {
                                        durable: true,
                                      }
                                    );
                                    //Send message
                                    let message = {
                                      user_fingerprint: req.user_fingerprint,
                                      requestType: "rides",
                                      user_nature: "rider",
                                    };
                                    channel.sendToQueue(
                                      process.env
                                        .TRIPS_UPDATE_AFTER_BOOKING_QUEUE_NAME,
                                      Buffer.from(JSON.stringify(message)),
                                      {
                                        persistent: true,
                                      }
                                    );
                                    //! -------------
                                    if (
                                      /successfully_requested/i.test(
                                        resultDispatch.response
                                      )
                                    ) {
                                      //? CHECK IF IT'S A DELIVERY REQUEST TO NOTIFY THE RECEIVER
                                      if (
                                        /delivery/i.test(
                                          parsedRequest.ride_mode
                                        )
                                      ) {
                                        //Delivery
                                        new Promise((resNotifyReceiver) => {
                                          let receiversPhone =
                                            parsedRequest.delivery_infos.receiverPhone_delivery.replace(
                                              "+",
                                              ""
                                            );
                                          let receiverName = ucFirst(
                                            parsedRequest.delivery_infos.receiverName_delivery.trim()
                                          );
                                          let message = `Hello ${receiverName}, a package is being delivered to you via TaxiConnect, you can track it by creating a TaxiConnect account with your current number.\n\nThe TaxiConnect teams.`;
                                          //!Check if the receiver is a current user
                                          collectionPassengers_profiles
                                            .find({
                                              phone_number:
                                                parsedRequest.delivery_infos.receiverPhone_delivery.trim(),
                                            })
                                            .toArray(function (
                                              err,
                                              userReceiverData
                                            ) {
                                              if (err) {
                                                resNotifyReceiver(false);
                                              }
                                              //...
                                              if (
                                                userReceiverData !==
                                                  undefined &&
                                                userReceiverData.length > 0
                                              ) {
                                                //Is a TaxiConnect user, check for how long the app has not been used.
                                                resolveDate();
                                                if (
                                                  userReceiverData.last_updated !==
                                                    undefined &&
                                                  userReceiverData.last_updated !==
                                                    null
                                                ) {
                                                  //Check the time
                                                  let lastUserUpdated =
                                                    new Date(
                                                      userReceiverData.last_updated
                                                    );
                                                  let refNowDate = new Date(
                                                    chaineDateUTC
                                                  );
                                                  //...
                                                  if (
                                                    diff_hours(
                                                      refNowDate,
                                                      lastUserUpdated
                                                    ).difference >
                                                    7 * 24
                                                  ) {
                                                    //If greater than 7 days - send SMS
                                                    SendSMSTo(
                                                      receiversPhone,
                                                      message
                                                    );
                                                    resNotifyReceiver(true);
                                                  } //Send push notification
                                                  else {
                                                    let messageNotify = {
                                                      app_id:
                                                        process.env
                                                          .RIDERS_APP_ID_ONESIGNAL,
                                                      android_channel_id:
                                                        process.env
                                                          .RIDERS_ONESIGNAL_CHANNEL_ACCEPTTEDD_REQUEST, //Ride - Accepted request
                                                      priority: 10,
                                                      contents: {
                                                        en: message,
                                                      },
                                                      headings: {
                                                        en: "Delivery in progress",
                                                      },
                                                      content_available: true,
                                                      include_player_ids: [
                                                        userReceiverData.pushnotif_token !==
                                                          false &&
                                                        userReceiverData.pushnotif_token !==
                                                          null &&
                                                        userReceiverData.pushnotif_token !==
                                                          "false"
                                                          ? userReceiverData
                                                              .pushnotif_token
                                                              .userId
                                                          : null,
                                                      ],
                                                    };
                                                    //Send
                                                    sendPushUPNotification(
                                                      messageNotify
                                                    );
                                                    resNotifyReceiver(true);
                                                  }
                                                } //Send an SMS, not logged in yet
                                                else {
                                                  SendSMSTo(
                                                    receiversPhone,
                                                    message
                                                  );
                                                  resNotifyReceiver(true);
                                                }
                                              } //Not a TaxiConnect user, Send an SMS
                                              else {
                                                SendSMSTo(
                                                  receiversPhone,
                                                  message
                                                );
                                                resNotifyReceiver(true);
                                              }
                                            });
                                        })
                                          .then()
                                          .catch(() => {});
                                      }
                                    }
                                    //...
                                    res.send(resultDispatch);
                                  },
                                  (error) => {
                                    //logger.info(error);
                                    res.send({
                                      response: "Unable_to_make_the_request",
                                    });
                                  }
                                );
                              } //Not enough money in the wallet
                              else {
                                /*logger.info(
                                  "Has NOT enough funds in the wallet"
                                );*/
                                res.send({
                                  response:
                                    "Unable_to_make_the_request_unsufficient_funds",
                                });
                              }
                            } //Error getting wallet amount
                            else {
                              res.send({
                                response:
                                  "Unable_to_make_the_request_error_wallet_check",
                              });
                            }
                          } catch (error) {
                            //logger.info(error);
                            res.send({
                              response:
                                "Unable_to_make_the_request_error_wallet_check",
                            });
                          }
                        } else {
                          res.send({
                            response:
                              "Unable_to_make_the_request_error_wallet_check",
                          });
                        }
                      });
                    } //? CASH PAYMENT METHOD
                    else {
                      //Do as usual without a wallet balance check
                      new Promise((resInit) => {
                        INIT_RIDE_DELIVERY_DISPATCH_ENTRY(
                          result,
                          collectionDrivers_profiles,
                          collectionRidesDeliveryData,
                          channel,
                          resInit
                        );
                      }).then(
                        (resultDispatch) => {
                          //! RABBITMQ MESSAGE
                          channel.assertQueue(
                            process.env.TRIPS_UPDATE_AFTER_BOOKING_QUEUE_NAME,
                            {
                              durable: true,
                            }
                          );
                          //Send message
                          let message = {
                            user_fingerprint: req.user_fingerprint,
                            requestType: "rides",
                            user_nature: "rider",
                          };
                          channel.sendToQueue(
                            process.env.TRIPS_UPDATE_AFTER_BOOKING_QUEUE_NAME,
                            Buffer.from(JSON.stringify(message)),
                            {
                              persistent: true,
                            }
                          );
                          //! -------------
                          res.send(resultDispatch);
                        },
                        (error) => {
                          //logger.info(error);
                          res.send({
                            response: "Unable_to_make_the_request",
                          });
                        }
                      );
                    }
                  } //Error
                  else {
                    res.send({ response: "Unable_to_make_the_request" });
                  }
                },
                (error) => {
                  //logger.info(error);
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
      //logger.info(req);
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
          confirmDropoff_fromRider_side(
            req,
            collectionRidesDeliveryData,
            collectionDrivers_profiles,
            channel,
            res0
          );
        }).then(
          (result) => {
            //! RABBITMQ MESSAGE
            channel.assertQueue(
              process.env.TRIPS_UPDATE_AFTER_BOOKING_QUEUE_NAME,
              {
                durable: true,
              }
            );
            //Send message
            let message = {
              user_fingerprint: req.user_fingerprint,
              requestType: "rides",
              user_nature: "rider",
            };
            channel.sendToQueue(
              process.env.TRIPS_UPDATE_AFTER_BOOKING_QUEUE_NAME,
              Buffer.from(JSON.stringify(message)),
              {
                persistent: true,
              }
            );
            //! Send message to update the driver's daily amount
            channel.assertQueue(process.env.TRIPS_DAILY_AMOUNT_DRIVERS_QUEUE, {
              durable: true,
            });
            //Send message
            message = {
              driver_fingerprint:
                result.driver_fp !== undefined && result.driver_fp !== null
                  ? result.driver_fp
                  : "unknown_fp",
            };
            channel.sendToQueue(
              process.env.TRIPS_DAILY_AMOUNT_DRIVERS_QUEUE,
              Buffer.from(JSON.stringify(message)),
              {
                persistent: true,
              }
            );
            //! -------------
            res.send(result);
          },
          (error) => {
            //logger.info(error);
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
      //logger.info(req);

      //Do basic checking
      if (
        req.user_fingerprint !== undefined &&
        req.user_fingerprint !== null &&
        req.request_fp !== undefined &&
        req.request_fp !== null
      ) {
        //? Add a flag if provided: the flag can be used to know who cancelled the request, if not provided, - it's the rider
        let additionalData = {
          flag: req.flag !== undefined && req.flag !== null ? req.flag : null,
        };
        //...
        new Promise((res0) => {
          cancelRider_request(
            req,
            collectionRidesDeliveryData,
            collection_cancelledRidesDeliveryData,
            collectionDrivers_profiles,
            channel,
            res0,
            additionalData
          );
        }).then(
          (result) => {
            //! RABBITMQ MESSAGE
            channel.assertQueue(
              process.env.TRIPS_UPDATE_AFTER_BOOKING_QUEUE_NAME,
              {
                durable: true,
              }
            );
            //Send message
            let message = {
              user_fingerprint: req.user_fingerprint,
              requestType: "rides",
              user_nature: "rider",
            };
            channel.sendToQueue(
              process.env.TRIPS_UPDATE_AFTER_BOOKING_QUEUE_NAME,
              Buffer.from(JSON.stringify(message)),
              {
                persistent: true,
              }
            );
            //! -------------
            res.send(result);
          },
          (error) => {
            //logger.info(error);
            res.send({ response: "error_cancelling" });
          }
        );
      } //Invalid parameters
      else {
        res.send({ response: "error_cancelling" });
      }
    });

    /**
     * DECLINE REQUESTS - DRIVERS
     * Responsible for handling the declining of requests from the drivers side.
     */
    app.post("/decline_request", function (req, res) {
      req = req.body;
      //logger.info(req);

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
            //logger.info(error);
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
      //...
      req = req.body;
      //logger.info(req);

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
            collectionDrivers_profiles,
            collectionPassengers_profiles,
            channel,
            res0
          );
        }).then(
          (result) => {
            if (
              result.response !== undefined &&
              result.response !== null &&
              result.rider_fp !== undefined &&
              result.rider_fp !== null
            ) {
              //! RABBITMQ MESSAGE
              channel.assertQueue(
                process.env.TRIPS_UPDATE_AFTER_BOOKING_QUEUE_NAME,
                {
                  durable: true,
                }
              );
              //Send message
              let message = {
                user_fingerprint: result.rider_fp,
                requestType: "rides",
                user_nature: "rider",
              };
              channel.sendToQueue(
                process.env.TRIPS_UPDATE_AFTER_BOOKING_QUEUE_NAME,
                Buffer.from(JSON.stringify(message)),
                {
                  persistent: true,
                }
              );
              //! -------------
            }
            //...
            res.send(result);
          },
          (error) => {
            //logger.info(error);
            res.send({ response: "unable_to_accept_request_error" });
          }
        );
      }
    });

    /**
     * CANCEL REQUESTS - DRIVERS
     * Responsible for handling the cancelling of requests from the drivers side.
     */
    app.post("/cancel_request_driver", function (req, res) {
      //DEBUG
      /*req.body = {
    driver_fingerprint:
      "23c9d088e03653169b9c18193a0b8dd329ea1e43eb0626ef9f16b5b979694a429710561a3cb3ddae",
    request_fp:
      "999999f5c51c380ef9dee9680872a6538cc9708ef079a8e42de4d762bfa7d49efdcde41c6009cbdd9cdf6f0ae0544f74cb52caa84439cbcda40ce264f90825e8",
  };*/
      //...
      req = req.body;
      //logger.info(req);

      //Do basic checking
      if (
        req.driver_fingerprint !== undefined &&
        req.driver_fingerprint !== null &&
        req.request_fp !== undefined &&
        req.request_fp !== null
      ) {
        //...
        new Promise((res0) => {
          cancelRequest_driver(
            req,
            collectionRidesDeliveryData,
            collectionGlobalEvents,
            collectionPassengers_profiles,
            collectionDrivers_profiles,
            channel,
            res0
          );
        }).then(
          (result) => {
            if (
              result.response !== undefined &&
              result.response !== null &&
              result.rider_fp !== undefined &&
              result.rider_fp !== null
            ) {
              //! RABBITMQ MESSAGE
              channel.assertQueue(
                process.env.TRIPS_UPDATE_AFTER_BOOKING_QUEUE_NAME,
                {
                  durable: true,
                }
              );
              //Send message
              let message = {
                user_fingerprint: result.rider_fp,
                requestType: "rides",
                user_nature: "rider",
              };
              channel.sendToQueue(
                process.env.TRIPS_UPDATE_AFTER_BOOKING_QUEUE_NAME,
                Buffer.from(JSON.stringify(message)),
                {
                  persistent: true,
                }
              );
              //! -------------
            }
            res.send(result);
          },
          (error) => {
            //logger.info(error);
            res.send({ response: "unable_to_cancel_request_error" });
          }
        );
      }
    });

    /**
     * CONFIRM PICKUP REQUESTS - DRIVERS
     * Responsible for handling the pickup confirmation of requests from the drivers side.
     */
    app.post("/confirm_pickup_request_driver", function (req, res) {
      //DEBUG
      /*req.body = {
    driver_fingerprint:
      "23c9d088e03653169b9c18193a0b8dd329ea1e43eb0626ef9f16b5b979694a429710561a3cb3ddae",
    request_fp:
      "999999f5c51c380ef9dee9680872a6538cc9708ef079a8e42de4d762bfa7d49efdcde41c6009cbdd9cdf6f0ae0544f74cb52caa84439cbcda40ce264f90825e8",
  };*/
      //...
      req = req.body;
      //logger.info(req);

      //Do basic checking
      if (
        req.driver_fingerprint !== undefined &&
        req.driver_fingerprint !== null &&
        req.request_fp !== undefined &&
        req.request_fp !== null
      ) {
        //...
        new Promise((res0) => {
          confirmPickupRequest_driver(
            req,
            collectionRidesDeliveryData,
            collectionGlobalEvents,
            collectionDrivers_profiles,
            channel,
            res0
          );
        }).then(
          (result) => {
            if (
              result.response !== undefined &&
              result.response !== null &&
              result.rider_fp !== undefined &&
              result.rider_fp !== null
            ) {
              //! RABBITMQ MESSAGE
              channel.assertQueue(
                process.env.TRIPS_UPDATE_AFTER_BOOKING_QUEUE_NAME,
                {
                  durable: true,
                }
              );
              //Send message
              let message = {
                user_fingerprint: result.rider_fp,
                requestType: "rides",
                user_nature: "rider",
              };
              channel.sendToQueue(
                process.env.TRIPS_UPDATE_AFTER_BOOKING_QUEUE_NAME,
                Buffer.from(JSON.stringify(message)),
                {
                  persistent: true,
                }
              );
              //! -------------
            }
            res.send(result);
          },
          (error) => {
            //logger.info(error);
            res.send({
              response: "unable_to_confirm_pickup_request_error",
            });
          }
        );
      }
    });

    /**
     * CONFIRM DROPOFF REQUESTS - DRIVERS
     * Responsible for handling the dropoff confirmation of requests from the drivers side.
     */
    app.post("/confirm_dropoff_request_driver", function (req, res) {
      //DEBUG
      /*req.body = {
    driver_fingerprint:
      "23c9d088e03653169b9c18193a0b8dd329ea1e43eb0626ef9f16b5b979694a429710561a3cb3ddae",
    request_fp:
      "999999f5c51c380ef9dee9680872a6538cc9708ef079a8e42de4d762bfa7d49efdcde41c6009cbdd9cdf6f0ae0544f74cb52caa84439cbcda40ce264f90825e8",
  };*/
      //...
      req = req.body;
      //logger.info(req);

      //Do basic checking
      if (
        req.driver_fingerprint !== undefined &&
        req.driver_fingerprint !== null &&
        req.request_fp !== undefined &&
        req.request_fp !== null
      ) {
        //...
        new Promise((res0) => {
          confirmDropoffRequest_driver(
            req,
            collectionRidesDeliveryData,
            collectionGlobalEvents,
            collectionPassengers_profiles,
            collectionDrivers_profiles,
            channel,
            res0
          );
        }).then(
          (result) => {
            if (
              result.response !== undefined &&
              result.response !== null &&
              result.rider_fp !== undefined &&
              result.rider_fp !== null
            ) {
              //! RABBITMQ MESSAGE
              channel.assertQueue(
                process.env.TRIPS_UPDATE_AFTER_BOOKING_QUEUE_NAME,
                {
                  durable: true,
                }
              );
              //Send message
              let message = {
                user_fingerprint: result.rider_fp,
                requestType: "rides",
                user_nature: "rider",
              };
              channel.sendToQueue(
                process.env.TRIPS_UPDATE_AFTER_BOOKING_QUEUE_NAME,
                Buffer.from(JSON.stringify(message)),
                {
                  persistent: true,
                }
              );
              //! -------------
            }
            res.send(result);
          },
          (error) => {
            //logger.info(error);
            res.send({
              response: "unable_to_confirm_dropoff_request_error",
            });
          }
        );
      }
    });
  });
});

server.listen(process.env.DISPATCH_SERVICE_PORT);
