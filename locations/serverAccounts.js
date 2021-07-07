require("dotenv").config();
//var dash = require("appmetrics-dash");
//require("newrelic");
var express = require("express");
const http = require("http");
const https = require("https");
const fs = require("fs");
var path = require("path");
var morgan = require("morgan");
const helmet = require("helmet");
const MongoClient = require("mongodb").MongoClient;
const { parse, stringify } = require("flatted");
const AWS = require("aws-sdk");
const s3 = new AWS.S3({
  accessKeyId: process.env.AWS_S3_ID,
  secretAccessKey: process.env.AWS_S3_SECRET,
});

var accessLogStream = fs.createWriteStream(
  path.join(__dirname, "accountService_access.log"),
  { flags: "a" }
);
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

var isBase64 = require("is-base64");
var chaineDateUTC = null;
const moment = require("moment");
var otpGenerator = require("otp-generator");

const clientMongo = new MongoClient(process.env.URL_MONGODB, {
  useUnifiedTopology: true,
  useNewUrlParser: true,
});

var AWS_SMS = require("aws-sdk");
function SendSMSTo(phone_number, message) {
  // Load the AWS SDK for Node.js
  // Set region
  AWS_SMS.config.update({ region: "us-east-1" });

  // Create publish parameters
  var params = {
    Message: message /* required */,
    PhoneNumber: phone_number,
  };

  // Create promise and SNS service object
  var publishTextPromise = new AWS_SMS.SNS({ apiVersion: "2010-03-31" })
    .publish(params)
    .promise();

  // Handle promise's fulfilled/rejected states
  publishTextPromise
    .then(function (data) {
      console.log("MessageID is " + data.MessageId);
    })
    .catch(function (err) {
      console.error(err, err.stack);
    });
  // let username = "taxiconnect";
  // let password = "Taxiconnect*1";

  // let postData = JSON.stringify({
  //   to: phone_number,
  //   body: message,
  // });

  // let options = {
  //   hostname: "api.bulksms.com",
  //   port: 443,
  //   path: "/v1/messages",
  //   method: "POST",
  //   headers: {
  //     "Content-Type": "application/json",
  //     "Content-Length": postData.length,
  //     Authorization:
  //       "Basic " + Buffer.from(username + ":" + password).toString("base64"),
  //   },
  // };

  // let req = https.request(options, (resp) => {
  //   logger.info("statusCode:", resp.statusCode);
  //   let data = "";
  //   resp.on("data", (chunk) => {
  //     data += chunk;
  //   });
  //   resp.on("end", () => {
  //     logger.info("Response:", data);
  //   });
  // });

  // req.on("error", (e) => {
  //   logger.warn(e);
  // });

  // req.write(postData);
  // req.end();
}

/*const numeral = require("numeral");
setInterval(() => {
  const { rss, heapTotal } = process.memoryUsage();
  logger.info(
    "rss",
    numeral(rss).format("0.0 ib"),
    "heapTotal",
    numeral(heapTotal).format("0.0 ib")
  );
}, 5000);*/

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
        "TAXICONNECTBASICKEYFINGERPRINTS-RIDES-DELIVERY-ACCOUNTS"
      )
      .update(str)
      .digest("hex");
    resolve(fingerprint);
  } else if (/md5/i.test(encryption)) {
    fingerprint = crypto
      .createHmac(
        "md5WithRSAEncryption",
        "TAXICONNECTBASICKEYFINGERPRINTS-RIDES-DELIVERY-ACCOUNTS"
      )
      .update(str)
      .digest("hex");
    resolve(fingerprint);
  } //Other - default - for creating accounts.
  else {
    fingerprint = crypto
      .createHmac(
        "sha256",
        "TAXICONNECTBASICKEYFINGERPRINTS-RIDES-DELIVERY-ACCOUNTS"
      )
      .update(str)
      .digest("hex");
    resolve(fingerprint);
  }
}

/**
 * @func checkUserStatus
 * @param userData: the user's bundled data (phone_number, user_nature,...)
 * @param otp: the otp generated for this user
 * @param collection_OTP_dispatch_map: the collection holding all the OTP dispatch
 * @param collectionPassengers_profiles: the collection of all the passengers
 * @param collectionDrivers_profiles: the collection of all the drivers
 * @param resolve
 * Responsible for checking whether the user is registeredd or not, if yes send back
 * the user fingerprint.
 */
function checkUserStatus(
  userData,
  otp,
  collection_OTP_dispatch_map,
  collectionPassengers_profiles,
  collectionDrivers_profiles,
  resolve
) {
  //Save the dispatch map for this user
  new Promise((res) => {
    let dispatchMap = {
      phone_number: userData.phone_number,
      otp: parseInt(otp),
      date_sent: new Date(chaineDateUTC),
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
    phone_number: { $regex: userData.phone_number.replace("+", "").trim() },
  }; //?Indexed

  logger.info(checkUser);

  //1. Passengers
  if (
    userData.user_nature === undefined ||
    userData.user_nature === null ||
    /passenger/i.test(userData.user_nature)
  ) {
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
            name: result[0].name,
            surname: result[0].surname,
            gender: result[0].gender,
            phone_number: result[0].phone_number,
            email: result[0].email,
            profile_picture: `${process.env.AWS_S3_RIDERS_PROFILE_PICTURES_PATH}/${result[0].media.profile_picture}`,
            account_state:
              result[0].account_state !== undefined &&
              result[0].account_state !== null
                ? result[0].account_state
                : "minimal",
            pushnotif_token: result[0].pushnotif_token,
          });
        } //Not yet registeredd
        else {
          resolve({ response: "not_yet_registered" });
        }
      });
  } else if (
    userData.user_nature !== undefined &&
    userData.user_nature !== null &&
    /driver/i.test(userData.user_nature)
  ) {
    /**
     * ! elligibility_status: {
     * !  status:'valid',		//valid, suspended, expelled
     * !  message: 'Message to display',
     * !  date_updated: ${date},
     * ! }
     */
    //2. Drivers
    collectionDrivers_profiles
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
            user_fp: result[0].driver_fingerprint,
            name: result[0].name,
            surname: result[0].surname,
            gender: result[0].gender,
            phone_number: result[0].phone_number,
            email: result[0].email,
            profile_picture: `${process.env.AWS_S3_DRIVERS_PROFILE_PICTURES_PATH}/${result[0].identification_data.profile_picture}`,
            account_state:
              result[0].elligibility_status !== undefined &&
              result[0].elligibility_status !== null
                ? result[0].elligibility_status.status
                : "valid", //? By default - Valid
            pushnotif_token: result[0].pushnotif_token,
            suspension_message: result[0].suspension_message,
          });
        } //Not yet registeredd
        else {
          resolve({ response: "not_yet_registered" });
        }
      });
  }
}

/**
 * @func getBachRidesHistory
 * @param collectionRidesDeliveryData: list of all rides made
 * @param collectionDrivers_profiles: list of all drivers
 * @param resolve
 * @param req: the requests arguments : user_fp, ride_type, and/or the targeted argument
 * ! Should contain a user nature: rider or driver
 */
function getBachRidesHistory(
  req,
  collectionRidesDeliveryData,
  collectionDrivers_profiles,
  resolve
) {
  //Resolve ride type object searcher
  new Promise((res0) => {
    if (req.targeted === undefined && req.request_fp === undefined) {
      //Batch request
      if (/past/i.test(req.ride_type)) {
        //Past requests
        let resolveResponse =
          req.user_nature === undefined ||
          req.user_nature === null ||
          /rider/i.test(req.user_nature)
            ? {
                client_id: req.user_fingerprint,
                "ride_state_vars.isRideCompleted_riderSide": true,
              }
            : {
                taxi_id: req.user_fingerprint,
                "ride_state_vars.isRideCompleted_riderSide": true,
              };
        //...
        res0(resolveResponse);
      } else if (/scheduled/i.test(req.ride_type)) {
        //Scheduled
        let resolveResponse =
          req.user_nature === undefined ||
          req.user_nature === null ||
          /rider/i.test(req.user_nature)
            ? {
                client_id: req.user_fingerprint,
                request_type: "scheduled",
              }
            : {
                taxi_id: req.user_fingerprint,
                request_type: "scheduled",
              };
        //...
        res0(resolveResponse);
      } else if (/business/i.test(req.ride_type)) {
        //Business
        let resolveResponse =
          req.user_nature === undefined ||
          req.user_nature === null ||
          /rider/i.test(req.user_nature)
            ? {
                client_id: req.user_fingerprint,
                ride_flag: "business",
              }
            : {
                taxi_id: req.user_fingerprint,
                ride_flag: "business",
              };
        //...
        res0(resolveResponse);
      } //Invalid data
      else {
        res0(false);
      }
    } //Targeted request
    else {
      logger.info("Targeted request detected!");
      let resolveResponse =
        req.user_nature === undefined ||
        req.user_nature === null ||
        /rider/i.test(req.user_nature)
          ? {
              client_id: req.user_fingerprint,
              request_fp: req.request_fp,
            }
          : {
              taxi_id: req.user_fingerprint,
              request_fp: req.request_fp,
            }; //?Indexed
      //...
      res0(resolveResponse);
    }
  }).then(
    (result) => {
      if (result !== false) {
        //Got some object
        //Get the mongodb data
        collectionRidesDeliveryData
          .find(result)
          .collation({ locale: "en", strength: 2 })
          .toArray(function (error, ridesData) {
            if (error) {
              resolve({ response: "error_authentication_failed" });
            }
            //...
            if (ridesData.length > 0) {
              //Found something - reformat
              let parentPromises = ridesData.map((requestSingle) => {
                return new Promise((res1) => {
                  shrinkDataSchema_forBatchRidesHistory(
                    requestSingle,
                    collectionDrivers_profiles,
                    res1,
                    req.target !== undefined ? true : false
                  );
                });
              });
              //Done
              Promise.all(parentPromises).then(
                (batchResults) => {
                  logger.info(batchResults);
                  resolve({
                    response: "success",
                    ride_type:
                      req.ride_type !== undefined
                        ? req.ride_type.trim().toUpperCase()
                        : "Targeted",
                    data: batchResults,
                  });
                },
                (error) => {
                  logger.info(error);
                  resolve({ response: "error_authentication_failed" });
                }
              );
            } //Empty
            else {
              //Get the rider's inos
              collectionPassengers_profiles
                .find({
                  user_fingerprint: req.user_fingerprint.trim(),
                })
                .toArray(function (err, riderData) {
                  if (err) {
                    resolve(false);
                  }
                  //...
                  if (riderData !== undefined && riderData.length > 0) {
                    //Found something
                    //? Check if the user is part of a delivery request iin which he is the receiver.
                    let rideChecker = {
                      "ride_state_vars.isRideCompleted_riderSide": true,
                      request_type: /scheduled/i.test(req.ride_type)
                        ? "scheduled"
                        : {
                            $in: ["scheduled", "business", "immediate"],
                          },
                      "delivery_infos.receiverPhone_delivery":
                        riderData[0].phone_number.trim(),
                    }; //?Indexed
                    //...
                    collectionRidesDeliveryData
                      .find(rideChecker)
                      .collation({ locale: "en", strength: 2 })
                      .toArray(function (err, tripData) {
                        if (err) {
                          resolve(false);
                        }
                        //...
                        if (tripData !== undefined && tripData.length > 0) {
                          let ridesData = tripData;
                          //Found the trip data
                          //Check if there are any requests cached
                          //Found something - reformat
                          let parentPromises = ridesData.map(
                            (requestSingle) => {
                              return new Promise((res1) => {
                                shrinkDataSchema_forBatchRidesHistory(
                                  requestSingle,
                                  collectionDrivers_profiles,
                                  res1,
                                  req.target !== undefined ? true : false
                                );
                              });
                            }
                          );
                          //Done
                          Promise.all(parentPromises).then(
                            (batchResults) => {
                              logger.info(batchResults);
                              resolve({
                                response: "success",
                                ride_type:
                                  req.ride_type !== undefined
                                    ? req.ride_type.trim().toUpperCase()
                                    : "Targeted",
                                data: batchResults,
                              });
                            },
                            (error) => {
                              logger.info(error);
                              resolve({
                                response: "error_authentication_failed",
                              });
                            }
                          );
                        } //No trip data
                        else {
                          resolve({
                            response: "success",
                            ride_type:
                              req.ride_type !== undefined
                                ? req.ride_type.trim().toUpperCase()
                                : "Targeted",
                            data: [],
                          });
                        }
                      });
                  } //No rider data, strange
                  else {
                    resolve({
                      response: "success",
                      ride_type:
                        req.ride_type !== undefined
                          ? req.ride_type.trim().toUpperCase()
                          : "Targeted",
                      data: [],
                    });
                  }
                });
            }
          });
      } //invalid data
      else {
        logger.info("Invalid");
        resolve({ response: "error_authentication_failed" });
      }
    },
    (error) => {
      logger.info(error);
      resolve({ response: "error_authentication_failed" });
    }
  );
}

/**
 * @func shrinkDataSchema_forBatchRidesHistory
 * @param request: a single request to process
 * @param collectionDrivers_profiles: list of all drivers
 * @param resolve
 * @param shrink_for_targeted: if true will format the request for a specific request - default: false (for batch requests)
 * @info Targeted requests have significantly more data than batch requests - AND REQUIRED TO BE CACHED!
 * Responsible for changing the original stored data schema of a request into a light
 * batch optimized on for BACTH history fetching.
 *{
 *    destination_name:destination_1,destination_2,...
 *    date_requested: dd/mm/yyyy, hh:mm
 *    car_brand: Toyota corolla
 *    request_fp: XXXXXXXXXX
 * }
 *
 * 2. Schema example for targeted requests - SHOULD BE CACHED - redis key: request_fp-your_rides_app_history
 * {
 *    pickup_name: pickup location
 *    destination_name:destination_1,destination_2,...
 *    date_requested: dd/mm/yyyy, hh:mm
 *    estimated_travel_time: 2min (in minutes)
 *    payment_method: cash/wallet
 *    ride_mode:RIDE/DELIVERY
 *    fare_amount: N$15
 *    numberOf_passengers: 4,
 *    ride_rating: 4.7
 *    driver_details: {
 *    name: 'Alex Tangeni'
 *    driver_picture: default_driver.png
 *    }
 *    car_details: {
 *      plate_number: 'N 458 W',
 *      car_brand: Toyota corolla
 *      car_picture: default_car.png
 *      taxi_number:H09/or false for shuttles
 *      vehicle_type:Economy,Comfort or Luxury
 *      verification_status: true
 *    }
 *    request_fp: XXXXXXXXXX
 * }
 */
function shrinkDataSchema_forBatchRidesHistory(
  request,
  collectionDrivers_profiles,
  resolve,
  shrink_for_targeted = false
) {
  logger.info("is targeted -> ", shrink_for_targeted);
  if (shrink_for_targeted === false) {
    //Batch requests
    let light_request_schema = {
      destination_name: null,
      date_requested: null,
      car_brand: null,
      request_fp: null,
    }; //Will hold the final product
    //1. Reformat the data
    let dateRequest = new Date(request.date_requested);
    dateRequest = moment(dateRequest.getTime());
    dateRequest =
      (String(dateRequest.date()).length > 1
        ? dateRequest.date()
        : "0" + dateRequest.date()) +
      "/" +
      (String(dateRequest.month() + 1).length > 1
        ? dateRequest.month() + 1
        : "0" + (dateRequest.month() + 1)) +
      "/" +
      dateRequest.year() +
      ", " +
      (String(dateRequest.hour()).length > 1
        ? dateRequest.hour()
        : "0" + dateRequest.hour()) +
      ":" +
      (String(dateRequest.minute()).length > 1
        ? dateRequest.minute()
        : "0" + dateRequest.minute());
    //Save
    light_request_schema.date_requested = dateRequest;
    //2. Get the car brand
    new Promise((res) => {
      let findCar = {
        "cars_data.car_fingerprint": request.car_fingerprint,
      };
      collectionDrivers_profiles.find(findCar).toArray(function (err, result) {
        if (err) {
          res(false);
        }
        //...
        logger.info(result);
        if (result.length > 0) {
          //FOund something
          let car_brand = false;
          //Get the car brand
          result.map((driver) => {
            driver.cars_data.map((car) => {
              if (request.car_fingerprint === car.car_fingerprint) {
                car_brand = car.car_brand;
              }
            });
          });
          //...
          res(car_brand);
        } //Empty - strange
        else {
          //! Get the first car for the driver
          collectionDrivers_profiles
            .find({ driver_fingerprint: request.taxi_id })
            .toArray(function (err, driverProfile) {
              if (err) {
                res(false);
              }
              ///.
              if (
                driverProfile.cars_data !== undefined &&
                driverProfile.cars_data !== null &&
                driverProfile.length > 0 &&
                driverProfile.cars_data.length > 0
              ) {
                //Found something
                res(driverProfile.cars_data[0].car_brand);
              } //No valid reccord found
              else {
                res(false);
              }
            });
        }
      });
    }).then(
      (result) => {
        if (result !== false) {
          //good
          //Save
          light_request_schema.car_brand = result;
          //3. Resolve the destinations
          request.destinationData.map((location) => {
            if (light_request_schema.destination_name === null) {
              //Still empty
              light_request_schema.destination_name =
                location.location_name !== false &&
                location.location_name !== undefined
                  ? location.location_name
                  : location.suburb !== false && location.suburb !== undefined
                  ? location.suburb
                  : "Click for more";
            } //Add
            else {
              light_request_schema.destination_name +=
                ", " +
                (location.location_name !== false &&
                location.location_name !== undefined
                  ? location.location_name
                  : location.suburb !== false && location.suburb !== undefined
                  ? location.suburb
                  : "Click for more");
            }
          });
          //4. Finally add the request fp
          light_request_schema.request_fp = request.request_fp;
          //..Done
          resolve(light_request_schema);
        } //Error
        else {
          resolve(false);
        }
      },
      (error) => {
        logger.info(error);
        resolve(false);
      }
    );
  } //Targeted requests
  else {
    let redisKey = request.request_fp + "-your_rides_app_history";
    redisGet(redisKey).then(
      (resp) => {
        if (resp !== null) {
          //Has a record
          try {
            //Rehydrate the redis record
            new Promise((res) => {
              proceedTargeted_requestHistory_fetcher(
                request,
                collectionDrivers_profiles,
                redisKey,
                res
              );
            }).then(
              () => {},
              () => {}
            );
            //..Quickly respond to the user with the cached results
            resp = JSON.parse(resp);
            logger.info("cached result found");
            resolve(resp);
          } catch (error) {
            //Erro - make a fresh request
            logger.info(error);
            new Promise((res) => {
              proceedTargeted_requestHistory_fetcher(
                request,
                collectionDrivers_profiles,
                redisKey,
                res
              );
            }).then(
              (result) => {
                resolve(result);
              },
              (error) => {
                logger.info(error);
                resolve(false);
              }
            );
          }
        } //No records - make a fresh request
        else {
          new Promise((res) => {
            proceedTargeted_requestHistory_fetcher(
              request,
              collectionDrivers_profiles,
              redisKey,
              res
            );
          }).then(
            (result) => {
              resolve(result);
            },
            (error) => {
              logger.info(error);
              resolve(false);
            }
          );
        }
      },
      (error) => {
        //Error - make a fresh request
        logger.info(error);
        new Promise((res) => {
          proceedTargeted_requestHistory_fetcher(
            request,
            collectionDrivers_profiles,
            redisKey,
            res
          );
        }).then(
          (result) => {
            resolve(result);
          },
          (error) => {
            logger.info(error);
            resolve(false);
          }
        );
      }
    );
    //Check for a potential cached result
  }
}

/**
 * @func proceedTargeted_requestHistory_fetcher
 * @param request: the stored details of the targeted request straight from MongoDB
 * @param redisKey: the wanted cache key
 * @param collectionDrivers_profiles: list of all the drivers
 * @param resolve
 * Responsible for executing the fresh fetching of a targeted request
 */
function proceedTargeted_requestHistory_fetcher(
  request,
  collectionDrivers_profiles,
  redisKey,
  resolve
) {
  let full_request_schema = {
    pickup_name: null,
    destination_name: null,
    date_requested: null,
    estimated_travel_time: null,
    payment_method: null,
    ride_mode: null,
    fare_amount: null,
    numberOf_passengers: null,
    ride_rating: null,
    country: null,
    city: null,
    driver_details: {
      name: null,
      driver_picture: null,
    },
    car_details: {
      plate_number: null,
      car_brand: null,
      car_picture: null,
      taxi_number: null,
      vehicle_type: null,
      verification_status: null,
    },
    request_fp: null,
  }; //Will hold the final product
  //1. Reformat the data
  let dateRequest = new Date(request.date_requested);
  dateRequest = moment(dateRequest.getTime());
  dateRequest =
    (String(dateRequest.date()).length > 1
      ? dateRequest.date()
      : "0" + dateRequest.date()) +
    "/" +
    (String(dateRequest.month() + 1).length > 1
      ? dateRequest.month() + 1
      : "0" + (dateRequest.month() + 1)) +
    "/" +
    dateRequest.year() +
    ", " +
    (String(dateRequest.hour()).length > 1
      ? dateRequest.hour()
      : "0" + dateRequest.hour()) +
    ":" +
    (String(dateRequest.minute()).length > 1
      ? dateRequest.minute()
      : "0" + dateRequest.minute());
  //Save
  full_request_schema.date_requested = dateRequest;
  //2. Get the car details and driver details
  new Promise((res) => {
    let findCar = {
      "cars_data.car_fingerprint": request.car_fingerprint,
    };
    collectionDrivers_profiles.find(findCar).toArray(function (err, result) {
      if (err) {
        res(false);
      }
      //...
      if (result.length > 0) {
        //FOund something
        let car_brand = false;
        let plate_number = false;
        let car_picture = false;
        let driver_name = false;
        let taxi_number = false;
        let vehicle_type = false;
        let driver_picture = "default_driver.png";
        //Get the car brand
        result.map((driver) => {
          driver.cars_data.map((car) => {
            if (request.car_fingerprint === car.car_fingerprint) {
              logger.info(car);
              car_brand = car.car_brand;
              car_picture = `${process.env.AWS_S3_VEHICLES_PICTURES_PATH}/${car.taxi_picture}`;
              taxi_number = car.taxi_number;
              vehicle_type = /Economy/i.test(car.vehicle_type)
                ? "Economy"
                : /Comfort/i.test(car.vehicle_type)
                ? "Comfort"
                : /Luxury/i.test(car.vehicle_type);
              plate_number = car.plate_number.toUpperCase();
              plate_number =
                plate_number[0] +
                " " +
                plate_number.substring(1, plate_number.length - 1) +
                " " +
                plate_number[plate_number.length - 1];
              driver_name = driver.name + " " + driver.surname;
              driver_picture = `${process.env.AWS_S3_DRIVERS_PROFILE_PICTURES_PATH}/${driver.identification_data.profile_picture}`;
            }
          });
        });
        //...
        res({
          car_brand: car_brand,
          plate_number: plate_number,
          car_picture: car_picture,
          taxi_number: taxi_number,
          vehicle_type: vehicle_type,
          driver_name: driver_name,
          driver_picture: driver_picture,
        });
      } //Empty - strange
      else {
        res(false);
      }
    });
  }).then(
    (result) => {
      if (result !== false) {
        //good
        //Save
        full_request_schema.car_details.car_brand = result.car_brand;
        full_request_schema.car_details.plate_number = result.plate_number;
        full_request_schema.car_details.car_picture = result.car_picture;
        full_request_schema.car_details.taxi_number = result.taxi_number;
        full_request_schema.car_details.vehicle_type = result.vehicle_type;
        full_request_schema.car_details.verification_status = "Verified"; //By default
        full_request_schema.driver_details.name = result.driver_name;
        full_request_schema.driver_details.driver_picture =
          result.driver_picture;
        //3. Resolve the destinations
        request.destinationData.map((location) => {
          if (full_request_schema.destination_name === null) {
            //Still empty
            full_request_schema.destination_name =
              location.location_name !== false &&
              location.location_name !== undefined
                ? location.location_name
                : location.suburb !== false && location.suburb !== undefined
                ? location.suburb
                : "Click for more";
          } //Add
          else {
            full_request_schema.destination_name +=
              ", " +
              (location.location_name !== false &&
              location.location_name !== undefined
                ? location.location_name
                : location.suburb !== false && location.suburb !== undefined
                ? location.suburb
                : "Click for more");
          }
        });
        //4. Resolve pickup location name
        full_request_schema.pickup_name =
          request.pickup_location_infos.location_name !== false &&
          request.pickup_location_infos.location_name !== undefined
            ? request.pickup_location_infos.location_name
            : request.pickup_location_infos.street_name !== false &&
              request.pickup_location_infos.street_name !== undefined
            ? request.pickup_location_infos.street_name
            : request.pickup_location_infos.suburb !== false &&
              request.pickup_location_infos.suburb !== undefined
            ? request.pickup_location_infos.suburb
            : "unclear location.";
        //5. Add fare amount
        full_request_schema.fare_amount = request.fare;
        //6. Add the number of passengers
        full_request_schema.numberOf_passengers = request.passengers_number;
        //7. Add ride rating
        full_request_schema.ride_rating = request.rider_driverRating;
        //8. Add country and city
        full_request_schema.country = request.country;
        full_request_schema.city = null;
        //9. Add payment method
        full_request_schema.payment_method =
          request.payment_method.toUpperCase();
        //10. Add ride mode
        full_request_schema.ride_mode = request.ride_mode;
        //11. Add the ride rating
        full_request_schema.ride_rating =
          request.ride_state_vars.rider_driverRating;
        //x. Finally add the request fp
        full_request_schema.request_fp = request.request_fp;
        //9. Add estimated travel time to the first destination
        let originPoint = request.pickup_location_infos.coordinates;
        let destinationPoint = request.destinationData[0].coordinates;
        new Promise((res4) => {
          let url =
            process.env.LOCAL_URL +
            ":" +
            process.env.MAP_SERVICE_PORT +
            "/getRouteToDestinationSnapshot?org_latitude=" +
            originPoint.latitude +
            "&org_longitude=" +
            originPoint.longitude +
            "&dest_latitude=" +
            destinationPoint.latitude +
            "&dest_longitude=" +
            destinationPoint.longitude +
            "&user_fingerprint=" +
            request.client_id;
          requestAPI(url, function (error, response, body) {
            if (error === null) {
              try {
                body = JSON.parse(body);
                res4(body.eta.replace(" away", "").replace(" ", ""));
              } catch (error) {
                res4(false);
              }
            } else {
              res4(false);
            }
          });
        }).then(
          (e_travel_time) => {
            if (e_travel_time !== false) {
              //Found an eta
              //Add eta
              full_request_schema.estimated_travel_time = e_travel_time;
              //Cache the result
              new Promise((resCache) => {
                redisCluster.set(redisKey, JSON.stringify(full_request_schema));
                resCache(true);
              }).then(
                () => {},
                () => {}
              );
              //..Done
              resolve(full_request_schema);
            } //No eta found
            else {
              //..Done
              resolve(full_request_schema);
            }
          },
          (error) => {
            //..Done
            resolve(full_request_schema);
          }
        );
      } //Error
      else {
        resolve(false);
      }
    },
    (error) => {
      logger.info(error);
      resolve(false);
    }
  );
}

/**
 * @func getDaily_requestAmount_driver
 * Responsible for getting the daily amount made so far for the driver at any given time.
 * CACHED.
 * @param collectionRidesDeliveryData: the list of all the rides/deliveries
 * @param collectionDrivers_profiles: the list of all the drivers profiles
 * @param avoidCached_data: to avoid the cached data
 * @param resolve
 */
function getDaily_requestAmount_driver(
  collectionRidesDeliveryData,
  collectionDrivers_profiles,
  driver_fingerprint,
  avoidCached_data = false,
  resolve
) {
  resolveDate();
  //Form the redis key
  let redisKey = "dailyAmount-" + driver_fingerprint;
  logger.info(driver_fingerprint);
  //..
  redisGet(redisKey).then(
    (resp) => {
      if (resp !== null && avoidCached_data == false) {
        //Has a previous record
        try {
          resp = JSON.parse(resp);
          //...
          resolve(resp);
        } catch (error) {
          logger.info(error);
          //Errror - make a fresh request
          new Promise((res) => {
            exec_computeDaily_amountMade(
              collectionRidesDeliveryData,
              collectionDrivers_profiles,
              driver_fingerprint,
              res
            );
          }).then(
            (result) => {
              logger.info(result);
              //Cache as well
              redisCluster.set(redisKey, JSON.stringify(result));
              resolve(result);
            },
            (error) => {
              resolve({
                amount: 0,
                currency: "NAD",
                currency_symbol: "N$",
                supported_requests_types: "none",
                response: "error",
              });
            }
          );
        }
      } //No computed amount yet - make a fresh request
      else {
        new Promise((res) => {
          exec_computeDaily_amountMade(
            collectionRidesDeliveryData,
            collectionDrivers_profiles,
            driver_fingerprint,
            res
          );
        }).then(
          (result) => {
            logger.info(result);
            //Cache as well
            redisCluster.set(redisKey, JSON.stringify(result));
            resolve(result);
          },
          (error) => {
            resolve({
              amount: 0,
              currency: "NAD",
              currency_symbol: "N$",
              supported_requests_types: "none",
              response: "error",
            });
          }
        );
      }
    },
    (error) => {
      logger.info(error);
      //Errror - make a fresh request
      new Promise((res) => {
        exec_computeDaily_amountMade(
          collectionRidesDeliveryData,
          collectionDrivers_profiles,
          driver_fingerprint,
          res
        );
      }).then(
        (result) => {
          logger.info(result);
          //Cache as well
          redisCluster.set(redisKey, JSON.stringify(result));
          resolve(result);
        },
        (error) => {
          resolve({
            amount: 0,
            currency: "NAD",
            currency_symbol: "N$",
            supported_requests_types: "none",
            response: "error",
          });
        }
      );
    }
  );
}

/**
 * @func exec_computeDaily_amountMade
 * Responsible for executing all the operations related to the computation of the driver's daily amount.
 * @param collectionRidesDeliveryData: the list of all the rides/deliveries
 * @param collectionDrivers_profiles: the list of all the drivers profiles.
 * @param resolve
 */
function exec_computeDaily_amountMade(
  collectionRidesDeliveryData,
  collectionDrivers_profiles,
  driver_fingerprint,
  resolve
) {
  resolveDate();
  //...
  //Get the driver's requests operation clearances
  logger.info(driver_fingerprint);
  collectionDrivers_profiles
    .find({ driver_fingerprint: driver_fingerprint })
    .toArray(function (error, driverProfile) {
      if (error) {
        resolve({
          amount: 0,
          currency: "NAD",
          currency_symbol: "N$",
          supported_requests_types: "none",
          response: "error",
        });
      }
      if (driverProfile !== undefined && driverProfile.length > 0) {
        driverProfile = driverProfile[0];
        //...
        let filterRequest = {
          taxi_id: driver_fingerprint,
          "ride_state_vars.isRideCompleted_driverSide": true,
          "ride_state_vars.isRideCompleted_riderSide": true,
        };

        collectionRidesDeliveryData
          .find(filterRequest)
          .collation({ locale: "en", strength: 2 })
          .toArray(function (err, requestsArray) {
            if (err) {
              resolve({
                amount: 0,
                currency: "NAD",
                currency_symbol: "N$",
                supported_requests_types:
                  driverProfile !== undefined && driverProfile !== null
                    ? driverProfile.operation_clearances.join("-")
                    : "Ride",
                response: "error",
              });
            }
            //...
            let amount = 0;
            if (requestsArray !== undefined && requestsArray.length > 0) {
              requestsArray.map((request) => {
                if (
                  String(chaineDateUTC)
                    .replace("T", " ")
                    .split(" ")[0]
                    .trim() ===
                  String(new Date(request.date_requested).toISOString())
                    .replace("T", " ")
                    .split(" ")[0]
                    .trim()
                ) {
                  //Same day
                  let tmpFare = parseFloat(request.fare);
                  amount += tmpFare;
                }
              });
              resolve({
                amount: amount,
                currency: "NAD",
                currency_symbol: "N$",
                supported_requests_types:
                  driverProfile !== undefined && driverProfile !== null
                    ? driverProfile.operation_clearances.join("-")
                    : "Ride",
                response: "success",
              });
            } //No infos
            else {
              resolve({
                amount: 0,
                currency: "NAD",
                currency_symbol: "N$",
                supported_requests_types:
                  driverProfile !== undefined && driverProfile !== null
                    ? driverProfile.operation_clearances.join("-")
                    : "Ride",
                response: "error",
              });
            }
          });
      } else {
        resolve({
          amount: 0,
          currency: "NAD",
          currency_symbol: "N$",
          supported_requests_types: "none",
          response: "error",
        });
      }
    });
}

/**
 * @func getRiders_wallet_summary
 * Responsible for getting riders wallet informations.
 * @param requestObj: contains the user_fingerprint and the mode: total or detailed.
 * @param collectionRidesDeliveryData: the collection of all the requests.
 * @param collectionWalletTransactions_logs: the collection of all the possible wallet transactions.
 * @param collectionDrivers_profiles: collection of all the drivers
 * @param collectionPassengers_profiles: collection of all the passengers.
 * @param resolve
 * @param avoidCached_data: false (will return cached data first) or true (will not return the cached data);
 * @param userType: rider or driver
 * Cache for 5 min only
 * Redis Key: user_fingerprint+wallet-summaryInfos
 */
function getRiders_wallet_summary(
  requestObj,
  collectionRidesDeliveryData,
  collectionWalletTransactions_logs,
  collectionDrivers_profiles,
  collectionPassengers_profiles,
  resolve,
  avoidCached_data = false,
  userType = "rider"
) {
  //Form the redis key
  let redisKey = requestObj.user_fingerprint + "wallet-summary";
  redisGet(redisKey).then(
    (resp) => {
      if (resp !== null && avoidCached_data == false) {
        logger.info("found cached data");
        //Has a previous record - reply with it and rehydrate the data
        try {
          //! USE MESSAGE QUEUES TO UPDATE THE WALLET
          //...Immediatly reply
          if (avoidCached_data === false || avoidCached_data === undefined) {
            resp = parse(resp);
            resolve(resp);
          }
        } catch (error) {
          logger.info(error);
          //Error - make a fresh request
          new Promise((res) => {
            execGet_ridersDrivers_walletSummary(
              requestObj,
              collectionRidesDeliveryData,
              collectionWalletTransactions_logs,
              collectionDrivers_profiles,
              collectionPassengers_profiles,
              redisKey,
              res,
              userType,
              avoidCached_data
            );
          }).then(
            (result) => {
              //? Cache
              redisCluster.set(redisKey, stringify(result));
              resolve(result);
            },
            (error) => {
              logger.info(error);
              resolve({ total: 0, transactions_data: null });
            }
          );
        }
      } //No previous records
      else {
        logger.info("No previous cached data");
        new Promise((res) => {
          execGet_ridersDrivers_walletSummary(
            requestObj,
            collectionRidesDeliveryData,
            collectionWalletTransactions_logs,
            collectionDrivers_profiles,
            collectionPassengers_profiles,
            redisKey,
            res,
            userType,
            avoidCached_data
          );
        }).then(
          (result) => {
            //? Cache
            redisCluster.set(redisKey, stringify(result));
            resolve(result);
          },
          (error) => {
            logger.info(error);
            resolve({ total: 0, transactions_data: null });
          }
        );
      }
    },
    (error) => {
      logger.info(error);
      //Error happened - make a fresh request
      new Promise((res) => {
        execGet_ridersDrivers_walletSummary(
          requestObj,
          collectionRidesDeliveryData,
          collectionWalletTransactions_logs,
          collectionDrivers_profiles,
          collectionPassengers_profiles,
          redisKey,
          res,
          userType,
          avoidCached_data
        );
      }).then(
        (result) => {
          //? Cache
          redisCluster.set(redisKey, stringify(result));
          resolve(result);
        },
        (error) => {
          logger.info(error);
          resolve({ total: 0, transactions_data: null });
        }
      );
    }
  );
}

/**
 * @func parseDetailed_walletGetData
 * Responsible for parsing the detailed wallet details into a form that's suitable for clients and more uniform.
 * ! Remove private information like: fingerprints, mongodb ids.
 * @param detailed_walletRaw_details: the raw data coming from @execGet_ridersDrivers_walletSummary before caching.
 * @param collectionDrivers_profiles: the list of all the drivers.
 * @param collectionPassengers_profiles: the list of all the passengers
 * @param resolve
 */
function parseDetailed_walletGetData(
  detailed_walletRaw_details,
  collectionDrivers_profiles,
  collectionPassengers_profiles,
  resolve
) {
  if (
    detailed_walletRaw_details.transactions_data !== null &&
    detailed_walletRaw_details.transactions_data.length > 0
  ) {
    //Has some transaction data to parse
    let cleanTransactionData = [];
    let batchPromiser = detailed_walletRaw_details.transactions_data.map(
      (transaction, index) => {
        return new Promise((res) => {
          try {
            let tmpClean = {
              id: null,
              amount: null,
              payment_currency: null,
              transaction_nature: null,
              date_made: null,
              timestamp: null,
            };
            //...
            //? 1. Add the id number
            tmpClean.id = index;
            //? 2. add the amount
            tmpClean.amount = parseFloat(transaction.amount);
            //? 3. Payment currency
            tmpClean.payment_currency = process.env.PAYMENT_CURRENCY;
            //? 4. Add and resolve the date made and the timestamp
            let tmpDateHolder = /\,/i.test(transaction.date_captured)
              ? transaction.date_captured.split(", ")
              : null;
            let datElementHolder =
              tmpDateHolder !== null ? tmpDateHolder[0].split("-") : null;
            let validDate =
              tmpDateHolder !== null
                ? `${datElementHolder[2]}-${datElementHolder[1]}-${datElementHolder[0]}T${tmpDateHolder[1]}:00.000Z`
                : transaction.date_captured;

            let tmpDateCaptured = new Date(new String(validDate)); //! Avoid invalid date formats - BUG FIX ATTEMPT
            tmpClean.date_made = `${tmpDateCaptured.getDay()}/${
              tmpDateCaptured.getMonth() + 1
            }/${tmpDateCaptured.getFullYear()} ${tmpDateCaptured.getHours()}:${tmpDateCaptured.getMinutes()}`;
            try {
              tmpClean.rawDate_made = tmpDateCaptured.toISOString(); //! Save the ISO date captured.
            } catch (error) {
              logger.info(error);
              tmpClean.rawDate_made = transaction.date_requestedRaw;
            }
            tmpClean.timestamp = tmpDateCaptured.getTime();
            //? 5. Add the transaction nature
            tmpClean.transaction_nature = transaction.transaction_nature;
            //? 6. If the transaction nature is ride/delivery - add the payment method and driver data
            if (/(ride|delivery)/i.test(transaction.transaction_nature)) {
              tmpClean["payment_method"] = transaction.payment_method;
              tmpClean["driverData"] = transaction.driverData;
            }
            //? 7. Get the recipient name for any other non ride/delivery transactions in nature.
            if (!/(ride|delivery)/i.test(transaction.transaction_nature)) {
              //Everything except rides/deliveries
              if (
                /(topup|weeklyPaidDriverAutomatic|commissionTCSubtracted)/i.test(
                  tmpClean.transaction_nature
                )
              ) {
                //TOpups
                //? DONE FOR TOPUPS
                res(tmpClean);
              }

              if (/sentToFriend/i.test(tmpClean.transaction_nature)) {
                //Check the name from the passenger collection
                collectionPassengers_profiles
                  .find({ user_fingerprint: transaction.recipient_fp })
                  .toArray(function (err, recipientData) {
                    if (err) {
                      res(false);
                    }
                    //...
                    if (
                      recipientData.length > 0 &&
                      recipientData[0].user_fingerprint !== undefined &&
                      recipientData[0].user_fingerprint !== null
                    ) {
                      //? Add the recipient name and DONE
                      tmpClean["recipient_name"] = recipientData[0].name;
                      //DONE
                      res(tmpClean);
                    } //Strange, did not find any user recipient for this request
                    else {
                      res(false);
                    }
                  });
              } else if (
                /(paidDriver|sentToDriver)/i.test(tmpClean.transaction_nature)
              ) {
                //Check from the driver collection
                collectionDrivers_profiles
                  .find({ driver_fingerprint: transaction.recipient_fp })
                  .toArray(function (err, recipientData) {
                    if (err) {
                      res(false);
                    }
                    //...
                    if (
                      recipientData.length > 0 &&
                      recipientData[0].driver_fingerprint !== undefined &&
                      recipientData[0].driver_fingerprint !== null
                    ) {
                      //? Add the recipient name and DONE
                      tmpClean["recipient_name"] = recipientData[0].name;
                      //DONE
                      res(tmpClean);
                    } //Strange, did not find any user recipient for this request
                    else {
                      res(false);
                    }
                  });
              } else {
                res(false);
              }
            }
            //For rides or deliveries - DONE
            else {
              res(tmpClean);
            }
          } catch (error) {
            logger.warn(error);
            res(false);
          }
        });
      }
    );

    //...Get the batch promiser infos
    Promise.all(batchPromiser).then(
      (cleansedData) => {
        try {
          //? Clean the falses
          cleansedData = cleansedData.filter((transaction) => {
            return (
              transaction !== false &&
              transaction.timestamp !== undefined &&
              transaction.timestamp !== null &&
              !isNaN(transaction.timestamp)
            );
          });
          //? Sort
          cleansedData.sort((a, b) =>
            a.timestamp > b.timestamp ? -1 : b.timestamp > a.timestamp ? 1 : 0
          );
          //? DONE
          resolve(cleansedData);
        } catch (error) {
          logger.info(error);
          resolve(detailed_walletRaw_details);
        }
      },
      (error) => {
        logger.info(error);
        resolve(detailed_walletRaw_details);
      }
    );
  } //No transaction data - DO NOT MODIFY
  else {
    resolve(detailed_walletRaw_details);
  }
}

/**
 * @func execGet_ridersDrivers_walletSummary
 * Responsible for executing the requests and gather the rider's or driver's wallet complete infos.
 * @param requestObj: contains the user_fingerprint and the mode: total or detailed.
 * @param collectionRidesDeliveryData: the collection of all the requests.
 * @param collectionWalletTransactions_logs: the collection of all the possible wallet transactions.
 * @param collectionDrivers_profiles: collection of all the drivers
 * @param collectionPassengers_profiles: collection of all the passengers.
 * @param resolve
 * @param user_type: rider or driver (the type of user for which to show the wallet details).
 * @param avoidCached_data: to avoid cached data.
 *
 * ? transaction_nature types: topup, paidDriver, sentToDriver, sentToFriend.
 * ? The wallet payments for rides are stored in the rides/deliveries collection.
 */
function execGet_ridersDrivers_walletSummary(
  requestObj,
  collectionRidesDeliveryData,
  collectionWalletTransactions_logs,
  collectionDrivers_profiles,
  collectionPassengers_profiles,
  redisKey,
  resolve,
  user_type = "rider",
  avoidCached_data = false
) {
  let redisKeyHere = `${redisKey}-forExecRiders_drivers_summary`;
  redisGet(redisKeyHere)
    .then(
      (resp) => {
        if (resp !== null && avoidCached_data == false) {
          //? Refresh the cached data
          new Promise((resFresh) => {
            truelyExec_ridersDrivers_walletSummary(
              requestObj,
              collectionRidesDeliveryData,
              collectionWalletTransactions_logs,
              collectionDrivers_profiles,
              collectionPassengers_profiles,
              redisKey,
              resFresh,
              user_type
            );
          })
            .then(
              (result) => {
                redisCluster.set(redisKeyHere, stringify(result));
              },
              () => {}
            )
            .catch(() => {});
          //....Quickly reply
          resp = parse(resp);
          resolve(resp);
        } //Make a fresh request
        else {
          new Promise((resFresh) => {
            truelyExec_ridersDrivers_walletSummary(
              requestObj,
              collectionRidesDeliveryData,
              collectionWalletTransactions_logs,
              collectionDrivers_profiles,
              collectionPassengers_profiles,
              redisKey,
              resFresh,
              user_type
            );
          })
            .then(
              (result) => {
                redisCluster.set(redisKeyHere, stringify(result));
                resolve(result);
              },
              () => {
                resolve({ total: 0, transactions_data: null });
              }
            )
            .catch(() => {
              resolve({ total: 0, transactions_data: null });
            });
        }
      },
      (error) => {
        logger.info(error);
        //Make a fresh request
        new Promise((resFresh) => {
          truelyExec_ridersDrivers_walletSummary(
            requestObj,
            collectionRidesDeliveryData,
            collectionWalletTransactions_logs,
            collectionDrivers_profiles,
            collectionPassengers_profiles,
            redisKey,
            resFresh,
            user_type
          );
        })
          .then(
            (result) => {
              redisCluster.set(redisKeyHere, stringify(result));
              resolve(result);
            },
            () => {
              resolve({ total: 0, transactions_data: null });
            }
          )
          .catch(() => {
            resolve({ total: 0, transactions_data: null });
          });
      }
    )
    .catch((error) => {
      logger.info(error);
      //Make a fresh request
      new Promise((resFresh) => {
        truelyExec_ridersDrivers_walletSummary(
          requestObj,
          collectionRidesDeliveryData,
          collectionWalletTransactions_logs,
          collectionDrivers_profiles,
          collectionPassengers_profiles,
          redisKey,
          resFresh,
          user_type
        );
      })
        .then(
          (result) => {
            redisCluster.set(redisKeyHere, stringify(result));
            resolve(result);
          },
          () => {
            resolve({ total: 0, transactions_data: null });
          }
        )
        .catch(() => {
          resolve({ total: 0, transactions_data: null });
        });
    });
}

/**
 * @func truelyExec_ridersDrivers_walletSummary
 * Responsible for truly run the get operations for the wallets summary for the riders and drivers.
 * @param requestObj: contains the user_fingerprint and the mode: total or detailed.
 * @param collectionRidesDeliveryData: the collection of all the requests.
 * @param collectionWalletTransactions_logs: the collection of all the possible wallet transactions.
 * @param collectionDrivers_profiles: collection of all the drivers
 * @param collectionPassengers_profiles: collection of all the passengers.
 * @param resolve
 * @param user_type: rider or driver (the type of user for which to show the wallet details).
 */
function truelyExec_ridersDrivers_walletSummary(
  requestObj,
  collectionRidesDeliveryData,
  collectionWalletTransactions_logs,
  collectionDrivers_profiles,
  collectionPassengers_profiles,
  redisKey,
  resolve,
  user_type = "rider"
) {
  //Get the current amount and all the details.
  let detailsData = {
    topedupAmount: 0, //The amount of money toped up since the beginning.
    paid_totalAmount: 0, //The total amount paid in the platform for rides/deliveries
    transactions_data: null, //The topups transactions
  };
  //...
  //? 0. Get all the transactions received from other users
  new Promise((resReceivedTransactions) => {
    //! Should be user_fingerprint instead of recipient_fp for DRIVERS
    let filterReceived = {
      recipient_fp: requestObj.user_fingerprint,
      transaction_nature: {
        $in: [
          "sentToFriend",
          "paidDriver",
          "sentToDriver",
          "weeklyPaidDriverAutomatic",
          "commissionTCSubtracted",
        ],
      },
    }; //?Indexed
    //...
    collectionWalletTransactions_logs
      .find(filterReceived)
      .collation({ locale: "en", strength: 2 })
      .toArray(function (err, resultTransactionsReceived) {
        if (err) {
          logger.info(err);
          resReceivedTransactions({ total: 0, transactions_data: null });
        }
        //...
        if (
          resultTransactionsReceived !== undefined &&
          resultTransactionsReceived.length > 0
        ) {
          //Found some transactions
          let receivedDataShot = {
            total: 0,
            transactions_data: [],
          };
          //? Find the total of all the received transactions
          resultTransactionsReceived.map((transaction) => {
            //! Add all except the TaxiConnect commission
            if (
              /(commissionTCSubtracted|weeklyPaidDriverAutomatic)/i.test(
                transaction.transaction_nature
              ) === false
            ) {
              receivedDataShot.total += parseFloat(transaction.amount);
            } //! Substract the commission
            else {
              receivedDataShot.total -= parseFloat(transaction.amount);
            }
            //Save he record
            receivedDataShot.transactions_data.push(transaction);
          });
          //? DONE
          resReceivedTransactions(receivedDataShot);
        } //No recived transactions
        else {
          resReceivedTransactions({ total: 0, transactions_data: null });
        }
      });
  })
    .then(
      (receivedTransactionsData) => {
        //1. Get the total topups
        //? Or the drivers weekly payouts.
        new Promise((res) => {
          let filterTopups = {
            user_fingerprint: requestObj.user_fingerprint,
            transaction_nature: {
              $in: [
                "topup",
                "paidDriver",
                "sentToDriver",
                "sentToFriend",
                "weeklyPaidDriverAutomatic",
              ],
            },
          }; //?Indexed
          //...
          collectionWalletTransactions_logs
            .find(filterTopups)
            .collation({ locale: "en", strength: 2 })
            .toArray(function (err, resultTransactions) {
              if (err) {
                logger.info(err);
                res({ total: 0, transactions_data: null });
              }
              //..
              if (
                (resultTransactions !== undefined &&
                  resultTransactions.length > 0) ||
                /driver/i.test(user_type)
              ) {
                //Found some records
                //Save the transactions data
                detailsData.transactions_data = resultTransactions;
                //? Find the sum of all the transactions: topup (not including rides/deliveries)
                //! Remove the paidDriver, sentToDriver and sentToFriend.
                resultTransactions.map((transaction) => {
                  if (
                    /topup/i.test(transaction.transaction_nature) &&
                    /rider/i.test(user_type)
                  ) {
                    //! Add
                    detailsData.topedupAmount += parseFloat(transaction.amount);
                  } else if (
                    /(paidDriver|sentToDriver|sentToFriend)/i.test(
                      transaction.transaction_nature
                    ) &&
                    /rider/i.test(user_type)
                  ) {
                    //!Remove
                    detailsData.topedupAmount -= parseFloat(transaction.amount);
                  } else if (
                    /(weeklyPaidDriverAutomatic)/i.test(
                      transaction.transaction_nature
                    ) &&
                    /driver/i.test(user_type)
                  ) {
                    //! Remove automatic weekly payments from the total for the drivers
                    detailsData.topedupAmount += parseFloat(transaction.amount);
                    //Save he record
                    receivedTransactionsData.transactions_data =
                      receivedTransactionsData.transactions_data !==
                        undefined &&
                      receivedTransactionsData.transactions_data !== null
                        ? receivedTransactionsData.transactions_data
                        : [];
                    //...
                    /*receivedTransactionsData.transactions_data.push(
                      transaction
                    );*/
                  }
                });
                //Find the sum of all the paid transactions (rides/deliveries) - for wallet only
                //? Happend the cash data to the transaction data as well.
                //! Warning: Key policy ahead, do not touch!
                //! TIME BRIDGE
                //! Will only consider rides after the 31-03-2021 at exactly 23:59:59
                let filterPaidRequests = /rider/i.test(user_type)
                  ? {
                      client_id: requestObj.user_fingerprint,
                      isArrivedToDestination: true,
                    }
                  : {
                      taxi_id: requestObj.user_fingerprint,
                      isArrivedToDestination: true,
                      date_requested: {
                        $gte: new Date("2021-03-31T21:59:59.000Z"),
                      },
                    };
                //...Only consider the completed requests
                collectionRidesDeliveryData
                  .find(filterPaidRequests)
                  .collation({ locale: "en", strength: 2 })
                  .toArray(function (err, resultPaidRequests) {
                    if (err) {
                      logger.info(err);
                      res({ total: 0, transactions_data: null });
                    }
                    //...
                    if (
                      resultPaidRequests !== undefined &&
                      resultPaidRequests.length > 0
                    ) {
                      //Found some records
                      //Save the requests transaction data and find the sum of the paid transactions
                      let completedDataPromise = resultPaidRequests.map(
                        (paidRequests) => {
                          return new Promise((partialResolver) => {
                            //Get driver infos : for Taxis - taxi number / for private cars - drivers name
                            collectionDrivers_profiles
                              .find({
                                driver_fingerprint: paidRequests.taxi_id,
                              })
                              .toArray(function (err, driverProfile) {
                                if (err) {
                                  logger.info(err);
                                  partialResolver({
                                    total: 0,
                                    transactions_data: null,
                                  });
                                }
                                //...
                                //Gather driver data
                                let driverData = {
                                  name: null,
                                  car_brand: null,
                                  taxi_number: null,
                                };
                                if (driverProfile.length > 0) {
                                  driverProfile = driverProfile[0];
                                  if (driverProfile.cars_data !== undefined) {
                                    //Add name
                                    driverData.name = driverProfile.name;
                                    //Get car infos
                                    driverProfile.cars_data.map((car) => {
                                      if (
                                        car.car_fingerprint ===
                                        paidRequests.car_fingerprint
                                      ) {
                                        //Found car
                                        //Save car brand and/or fingerprint
                                        driverData.car_brand = car.car_brand;
                                        driverData.taxi_number =
                                          car.taxi_number;
                                      }
                                    });
                                  }
                                }

                                //1. Reformat the data
                                let dateRequest = new Date(
                                  paidRequests.date_requested
                                );
                                dateRequest = moment(dateRequest.getTime());
                                dateRequest =
                                  (String(dateRequest.date()).length > 1
                                    ? dateRequest.date()
                                    : "0" + dateRequest.date()) +
                                  "-" +
                                  (String(dateRequest.month() + 1).length > 1
                                    ? dateRequest.month() + 1
                                    : "0" + (dateRequest.month() + 1)) +
                                  "-" +
                                  dateRequest.year() +
                                  ", " +
                                  (String(dateRequest.hour()).length > 1
                                    ? dateRequest.hour()
                                    : "0" + dateRequest.hour()) +
                                  ":" +
                                  (String(dateRequest.minute()).length > 1
                                    ? dateRequest.minute()
                                    : "0" + dateRequest.minute());

                                //Only get the sum for the wallets requests
                                if (
                                  /wallet/i.test(paidRequests.payment_method)
                                ) {
                                  //Wallet - add the sum and save record to transaction data
                                  detailsData.paid_totalAmount += parseFloat(
                                    paidRequests.fare
                                  );
                                  //Save record
                                  partialResolver({
                                    amount: parseFloat(paidRequests.fare),
                                    transaction_nature: paidRequests.ride_mode,
                                    payment_method: paidRequests.payment_method,
                                    driverData: driverData,
                                    date_captured: dateRequest,
                                    date_requestedRaw:
                                      paidRequests.date_requested,
                                  });
                                } //Cash - only save transaction data
                                else {
                                  partialResolver({
                                    amount: parseFloat(paidRequests.fare),
                                    transaction_nature: paidRequests.ride_mode,
                                    payment_method: paidRequests.payment_method,
                                    driverData: driverData,
                                    date_captured: dateRequest,
                                    date_requestedRaw:
                                      paidRequests.date_requested,
                                  });
                                }
                                //...
                              });
                          });
                        }
                      );

                      //..DONE
                      Promise.all(completedDataPromise).then(
                        (finalData) => {
                          //Update the transaction data
                          detailsData.transactions_data =
                            detailsData.transactions_data !== null &&
                            detailsData.transactions_data !== undefined
                              ? [...detailsData.transactions_data, ...finalData]
                              : finalData;
                          //! Add the total received
                          detailsData.transactions_data =
                            receivedTransactionsData.transactions_data !==
                              null &&
                            receivedTransactionsData.transactions_data !==
                              undefined
                              ? [
                                  ...detailsData.transactions_data,
                                  ...receivedTransactionsData.transactions_data,
                                ]
                              : detailsData.transactions_data;
                          //! DONE - First Logic for the riders - second for drivers!
                          res(
                            /rider/i.test(user_type)
                              ? {
                                  total:
                                    detailsData.topedupAmount +
                                    receivedTransactionsData.total -
                                    detailsData.paid_totalAmount,
                                  transactions_data:
                                    detailsData.transactions_data,
                                }
                              : {
                                  total:
                                    -1 * detailsData.topedupAmount +
                                    receivedTransactionsData.total +
                                    detailsData.paid_totalAmount,
                                  transactions_data:
                                    detailsData.transactions_data,
                                }
                          );
                        },
                        (error) => {
                          logger.info(error);
                          //Done
                          res({ total: 0, transactions_data: null });
                        }
                      );
                    } //No paid requests yet - send the current total found
                    else {
                      res({
                        total:
                          detailsData.topedupAmount +
                          receivedTransactionsData.total -
                          detailsData.paid_totalAmount,
                        transactions_data:
                          receivedTransactionsData.transactions_data !== null &&
                          receivedTransactionsData.transactions_data !==
                            undefined
                            ? [
                                ...detailsData.transactions_data,
                                ...receivedTransactionsData.transactions_data,
                              ]
                            : detailsData.transactions_data,
                      });
                    }
                  });
              } //No topups records found - so return the transactions data
              else {
                //Find the sum of all the paid transactions (rides/deliveries) - for wallet only
                //? Happend the cash data to the transaction data as well.
                let filterPaidRequests = /rider/i.test(user_type)
                  ? {
                      client_id: requestObj.user_fingerprint,
                      isArrivedToDestination: true,
                    }
                  : {
                      taxi_id: requestObj.user_fingerprint,
                      isArrivedToDestination: true,
                    };
                //...Only consider the completed requests
                collectionRidesDeliveryData
                  .find(filterPaidRequests)
                  .collation({ locale: "en", strength: 2 })
                  .toArray(function (err, resultPaidRequests) {
                    if (err) {
                      logger.info(err);
                      res({ total: 0, transactions_data: null });
                    }
                    //...
                    if (
                      resultPaidRequests !== undefined &&
                      resultPaidRequests.length > 0
                    ) {
                      //Found some records
                      //Save the requests transaction data and find the sum of the paid transactions
                      let completedDataPromise = resultPaidRequests.map(
                        (paidRequests) => {
                          return new Promise((partialResolver) => {
                            //Get driver infos : for Taxis - taxi number / for private cars - drivers name
                            collectionDrivers_profiles
                              .find({
                                driver_fingerprint: paidRequests.taxi_id,
                              })
                              .toArray(function (err, driverProfile) {
                                if (err) {
                                  logger.info(err);
                                  partialResolver({
                                    total: 0,
                                    transactions_data: null,
                                  });
                                }
                                //...
                                //Gather driver data
                                let driverData = {
                                  name: null,
                                  car_brand: null,
                                  taxi_number: null,
                                };
                                if (driverProfile.length > 0) {
                                  driverProfile = driverProfile[0];
                                  if (driverProfile.cars_data !== undefined) {
                                    //Add name
                                    driverData.name = driverProfile.name;
                                    //Get car infos
                                    driverProfile.cars_data.map((car) => {
                                      if (
                                        car.car_fingerprint ===
                                        paidRequests.car_fingerprint
                                      ) {
                                        //Found car
                                        //Save car brand and/or fingerprint
                                        driverData.car_brand = car.car_brand;
                                        driverData.taxi_number =
                                          car.taxi_number;
                                      }
                                    });
                                  }
                                }

                                //1. Reformat the data
                                let dateRequest = new Date(
                                  paidRequests.date_requested
                                );
                                dateRequest = moment(dateRequest.getTime());
                                dateRequest =
                                  (String(dateRequest.date()).length > 1
                                    ? dateRequest.date()
                                    : "0" + dateRequest.date()) +
                                  "-" +
                                  (String(dateRequest.month() + 1).length > 1
                                    ? dateRequest.month() + 1
                                    : "0" + (dateRequest.month() + 1)) +
                                  "-" +
                                  dateRequest.year() +
                                  ", " +
                                  (String(dateRequest.hour()).length > 1
                                    ? dateRequest.hour()
                                    : "0" + dateRequest.hour()) +
                                  ":" +
                                  (String(dateRequest.minute()).length > 1
                                    ? dateRequest.minute()
                                    : "0" + dateRequest.minute());

                                //Only get the sum for the wallets requests
                                if (
                                  /wallet/i.test(paidRequests.payment_method)
                                ) {
                                  //Wallet - add the sum and save record to transaction data
                                  detailsData.paid_totalAmount += parseFloat(
                                    paidRequests.fare
                                  );
                                  //Save record
                                  partialResolver({
                                    amount: parseFloat(paidRequests.fare),
                                    transaction_nature: paidRequests.ride_mode,
                                    payment_method: paidRequests.payment_method,
                                    driverData: driverData,
                                    date_captured: dateRequest,
                                    date_requestedRaw:
                                      paidRequests.date_requested,
                                  });
                                } //Cash - only save transaction data
                                else {
                                  partialResolver({
                                    amount: parseFloat(paidRequests.fare),
                                    transaction_nature: paidRequests.ride_mode,
                                    payment_method: paidRequests.payment_method,
                                    driverData: driverData,
                                    date_captured: dateRequest,
                                    date_requestedRaw:
                                      paidRequests.date_requested,
                                  });
                                }
                                //...
                              });
                          });
                        }
                      );

                      //..DONE
                      Promise.all(completedDataPromise).then(
                        (finalData) => {
                          //Update the transaction data
                          detailsData.transactions_data =
                            detailsData.transactions_data !== null &&
                            detailsData.transactions_data !== undefined
                              ? [...detailsData.transactions_data, ...finalData]
                              : finalData;
                          //! Add the total received
                          detailsData.transactions_data =
                            receivedTransactionsData.transactions_data !==
                              null &&
                            receivedTransactionsData.transactions_data !==
                              undefined
                              ? [
                                  ...detailsData.transactions_data,
                                  ...receivedTransactionsData.transactions_data,
                                ]
                              : detailsData.transactions_data;
                          //! DONE - First Logic for the riders - second for drivers!
                          res(
                            /rider/i.test(user_type)
                              ? {
                                  total:
                                    detailsData.topedupAmount +
                                    receivedTransactionsData.total -
                                    detailsData.paid_totalAmount,
                                  transactions_data:
                                    detailsData.transactions_data,
                                }
                              : {
                                  total:
                                    -1 * detailsData.topedupAmount +
                                    receivedTransactionsData.total +
                                    detailsData.paid_totalAmount,
                                  transactions_data:
                                    detailsData.transactions_data,
                                }
                          );
                        },
                        (error) => {
                          logger.info(error);
                          //Done
                          res({ total: 0, transactions_data: null });
                        }
                      );
                    } //No paid requests yet - send the current total found
                    else {
                      try {
                        res({
                          total:
                            detailsData.topedupAmount +
                            receivedTransactionsData.total -
                            detailsData.paid_totalAmount,
                          transactions_data:
                            receivedTransactionsData.transactions_data !==
                              null &&
                            receivedTransactionsData.transactions_data !==
                              undefined
                              ? detailsData.transactions_data !== undefined &&
                                detailsData.transactions_data !== null
                                ? [
                                    ...detailsData.transactions_data,
                                    ...receivedTransactionsData.transactions_data,
                                  ]
                                : receivedTransactionsData.transactions_data
                              : detailsData.transactions_data,
                        });
                      } catch (error) {
                        logger.info(error);
                        //Done
                        res({
                          total: 0,
                          transactions_data: null,
                          flag: "error",
                        });
                      }
                    }
                  });
              }
            });
        }).then(
          (result) => {
            //? Clean data and CACHE
            new Promise((resCleanData) => {
              parseDetailed_walletGetData(
                result,
                collectionDrivers_profiles,
                collectionPassengers_profiles,
                resCleanData
              );
            })
              .then(
                (resultCleansedData) => {
                  //! ONLY OVERWRITE THE TRANSACTIONS DATA
                  result.transactions_data = resultCleansedData;
                  //Cache and reply
                  redisCluster.set(redisKey, stringify(result));
                  //Reply
                  resolve(result);
                },
                (error) => {
                  logger.info(error);
                  //Error - empty wallet -cache
                  redisCluster.set(
                    redisKey,
                    JSON.stringify({ total: 0, transactions_data: null })
                  );
                  //Reply
                  resolve({ total: 0, transactions_data: null });
                }
              )
              .catch((error) => {
                logger.info(error);
                //Error - empty wallet -cache
                redisCluster.set(
                  redisKey,
                  JSON.stringify({ total: 0, transactions_data: null })
                );
                //Reply
                resolve({ total: 0, transactions_data: null });
              });
            //?-----------------
          },
          (error) => {
            logger.info(error);
            //Error - empty wallet -cache
            redisCluster.set(
              redisKey,
              JSON.stringify({ total: 0, transactions_data: null })
            );
            //Reply
            resolve({ total: 0, transactions_data: null });
          }
        );
      },
      (error) => {
        logger.info(error);
        res({ total: 0, transactions_data: null });
      }
    )
    .catch((error) => {
      logger.info(error);
      res({ total: 0, transactions_data: null });
    });
}

/**
 * @func computeDriver_walletDeepInsights
 * Responsible for getting deep insights about the driver's wallet about all the payments during each week
 * of every year and a clear look on the total commission of TaxiConnect for each week of the year and globally.
 * ? Consider commissions for CASH or WALLET.
 * @param walletBasicData: the basic wallet data coming straight from the wallet history fetcher.
 * @param collectionWalletTransactions_logs: all the funds transactions done in the system.
 * @param driver_fingerprint: the driver's fingerprint
 * @param redisKey: the unique redis key where to cache the wallet data.
 * @param avoidCached_data: whether to return cached data first or perform a fresh computation (true or false).
 * ! Note that "avoidCached_data", when true, you should also set the same for the "walletBasicData" API to have consistent data.
 * @param resolve
 */
function computeDriver_walletDeepInsights(
  walletBasicData,
  collectionWalletTransactions_logs,
  driver_fingerprint,
  redisKey,
  avoidCached_data,
  resolve
) {
  redisGet(redisKey)
    .then(
      (resp) => {
        if (resp !== null && avoidCached_data == false) {
          //Send cached data
          try {
            resp = parse(resp);
            resolve(resp);
          } catch (error) {
            //Something's wrong perform a fresh computation
            logger.info(error);
            new Promise((resNewData) => {
              execGet_driversDeepInsights_fromWalletData(
                walletBasicData,
                collectionWalletTransactions_logs,
                driver_fingerprint,
                redisKey,
                resNewData
              );
            })
              .then(
                (result) => {
                  resolve(result);
                },
                (error) => {
                  logger.info(error);
                  resolve({
                    header: null,
                    weeks_view: null,
                    response: "error",
                  });
                }
              )
              .catch((error) => {
                logger.info(error);
                resolve({
                  header: null,
                  weeks_view: null,
                  response: "error",
                });
              });
          }
        } //? Send freshly computed data
        else {
          new Promise((resNewData) => {
            execGet_driversDeepInsights_fromWalletData(
              walletBasicData,
              collectionWalletTransactions_logs,
              driver_fingerprint,
              redisKey,
              resNewData
            );
          })
            .then(
              (result) => {
                resolve(result);
              },
              (error) => {
                logger.info(error);
                resolve({
                  header: null,
                  weeks_view: null,
                  response: "error",
                });
              }
            )
            .catch((error) => {
              logger.info(error);
              resolve({
                header: null,
                weeks_view: null,
                response: "error",
              });
            });
        }
      },
      (error) => {
        //Something's wrong perform a fresh computation
        logger.info(error);
        new Promise((resNewData) => {
          execGet_driversDeepInsights_fromWalletData(
            walletBasicData,
            collectionWalletTransactions_logs,
            driver_fingerprint,
            redisKey,
            resNewData
          );
        })
          .then(
            (result) => {
              resolve(result);
            },
            (error) => {
              logger.info(error);
              resolve({
                header: null,
                weeks_view: null,
                response: "error",
              });
            }
          )
          .catch((error) => {
            logger.info(error);
            resolve({
              header: null,
              weeks_view: null,
              response: "error",
            });
          });
      }
    )
    .catch((error) => {
      //Something's wrong perform a fresh computation
      logger.info(error);
      new Promise((resNewData) => {
        execGet_driversDeepInsights_fromWalletData(
          walletBasicData,
          collectionWalletTransactions_logs,
          driver_fingerprint,
          redisKey,
          resNewData
        );
      })
        .then(
          (result) => {
            resolve(result);
          },
          (error) => {
            logger.info(error);
            resolve({
              header: null,
              weeks_view: null,
              response: "error",
            });
          }
        )
        .catch((error) => {
          logger.info(error);
          resolve({
            header: null,
            weeks_view: null,
            response: "error",
          });
        });
    });
}

/**
 * @func getWeekNumber
 * Responsible for getting the week number for any specific date.
 * @param d: the date object
 */
function getWeekNumber(d) {
  // Copy date so don't modify original
  d = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  // Set to nearest Thursday: current date + 4 - current day number
  // Make Sunday's day number 7
  d.setUTCDate(d.getUTCDate() + 4 - (d.getUTCDay() || 7));
  // Get first day of year
  var yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  // Calculate full weeks to nearest Thursday
  var weekNo = Math.ceil(((d - yearStart) / 86400000 + 1) / 7);
  // Return array of year and week number
  return [d.getUTCFullYear(), weekNo];
}

/**
 * @func execGet_driversDeepInsights_fromWalletData
 * Responsible for actively executing the computation on the driver's basic wallet to get more insights from them.
 * @param walletBasicData: the basic wallet data coming straight from the wallet history fetcher.
 * @param collectionWalletTransactions_logs: hold all the transactions list
 * @param driver_fingerprint: the driver's fingerprint
 * @param redisKey: the unique redis key where to cache the wallet data.
 * @param resolve
 * ? WEEK OBJECT TEMPLATE
 * {
 *  week_number: number,
 *  day_name: (monday...),
 *  total_rides: number,
 *  total_deliveries: number,
 *  total_earning: number (Without comission removal),
 *  taxiconnect_commission: number,
 *  earning_due_to_driver: number
 *  daily_earning: {
 *    monday: number,
 *    tuesday: number,
 *    wednesday: number,
 *    thursday: number,
 *    friday: number,
 *    saturday: number,
 *    sunday: number
 *  },
 *  scheduled_payment_date: date
 * }
 * ? GLOBAL HEADER OBJECT
 * {
 *  remaining_commission: number,
 *  scheduled_payment_date: date
 * }
 * ? GENERAL OBJECT STRUCTURE
 * {
 *  header: GLOBAL HEADER OBJ
 *  weeks_view: WEEK OBJ TEMMPLATE
 * }
 */
function execGet_driversDeepInsights_fromWalletData(
  walletBasicData,
  collectionWalletTransactions_logs,
  driver_fingerprint,
  redisKey,
  resolve
) {
  if (
    walletBasicData.transactions_data !== null &&
    walletBasicData.transactions_data !== undefined &&
    walletBasicData.transactions_data.length > 0
  ) {
    let parentPromises = walletBasicData.transactions_data.map(
      (transaction) => {
        return new Promise((resCompute) => {
          //? *. Do a bulk computation, without specifying week specific data for now
          let templateOne = {
            week_number: null,
            year_number: null,
            day_name: null,
            earning_amount: null, //Specific for this transaction
            earning_amount_wallet: null, //Earnings only from the wallet
            total_rides: null, //Specific for this transaction
            total_deliveries: null, //Specific for this transaction
            taxiconnect_commission: null,
            earning_due_to_driver: null,
            driver_weekly_payout: null, //The money paid to the driver.
            transaction_nature: null,
            date_made: null,
          };
          //----
          //? Save the transaction nature and the date made
          templateOne.transaction_nature = transaction.transaction_nature;
          templateOne.date_made = transaction.rawDate_made;
          //? ------------
          //1. Get the week number and year number
          let weekYearDetails = getWeekNumber(
            new Date(transaction.rawDate_made)
          );
          templateOne.week_number = weekYearDetails[1];
          templateOne.year_number = weekYearDetails[0];
          //2. Get the day name (3 letters)
          templateOne.day_name = new Date(transaction.rawDate_made)
            .toString()
            .split(" ")[0];
          //! 3. Set the eearning for the day (WE TAKE COMMISSION ON EVERYTHING EXCEPT 'commission' and 'weekly')
          templateOne.earning_amount =
            !/(commissionTCSubtracted|weeklyPaidDriverAutomatic)/i.test(
              transaction.transaction_nature
            )
              ? parseFloat(transaction.amount)
              : 0;
          //! 3i. Set the earning only from wallet methods
          templateOne.earning_amount_wallet =
            !/(commissionTCSubtracted|weeklyPaidDriverAutomatic)/i.test(
              transaction.transaction_nature
            )
              ? /(paidDriver|sentToDriver)/i.test(
                  transaction.transaction_nature
                )
                ? parseFloat(transaction.amount)
                : /(RIDE|DELIVERY)/i.test(transaction.transaction_nature) &&
                  /WALLET/i.test(transaction.payment_method)
                ? parseFloat(transaction.amount)
                : 0
              : 0;

          //4. Set the ride/delivery - ONLLY for ride/delivery transactions
          templateOne.total_rides = /ride/i.test(transaction.transaction_nature)
            ? 1
            : 0;
          templateOne.total_deliveries = /delivery/i.test(
            transaction.transaction_nature
          )
            ? 1
            : 0;
          //! 5. Set the commission amount if the proper transaction nature is detectedd
          templateOne.taxiconnect_commission = /commissionTCSubtracted/i.test(
            transaction.transaction_nature
          )
            ? transaction.amount
            : 0;
          //! 6. Set the weekly payment if the proper transaction nature is detectedd
          templateOne.driver_weekly_payout = /weeklyPaidDriverAutomatic/i.test(
            transaction.transaction_nature
          )
            ? transaction.amount
            : 0;

          //! 7. Compute the earning due to the driver - CONSIDER ONLY CASH PAYMENTS
          if (
            /(RIDE|DELIVERY)/i.test(transaction.transaction_nature) &&
            /WALLET/i.test(transaction.payment_method)
          ) {
            templateOne.earning_due_to_driver_CASH = 0;
            //!ONLY WALLET
            templateOne.earning_due_to_driver =
              templateOne.earning_amount_wallet -
              templateOne.earning_amount_wallet *
                process.env.TAXICONNECT_COMMISSION;
            //DONE
            resCompute(templateOne);
          } else if (
            /(RIDE|DELIVERY)/i.test(transaction.transaction_nature) &&
            /CASH/i.test(transaction.payment_method)
          ) {
            //!ONLY CASH
            templateOne.earning_due_to_driver = 0; //Wallet to zero
            templateOne.earning_due_to_driver_CASH =
              templateOne.earning_amount -
              templateOne.earning_amount * process.env.TAXICONNECT_COMMISSION;
            //DONE
            resCompute(templateOne);
          } else if (
            /(paidDriver|sentToDriver)/i.test(transaction.transaction_nature)
          ) {
            templateOne.earning_due_to_driver_CASH = 0;
            //! WHEN A DRIVER IS PAID
            templateOne.earning_due_to_driver =
              templateOne.earning_amount_wallet -
              templateOne.earning_amount_wallet *
                process.env.TAXICONNECT_COMMISSION;
            //DONE
            resCompute(templateOne);
          } else {
            templateOne.earning_due_to_driver_CASH = 0;
            templateOne.earning_due_to_driver = 0;
            //DONE
            resCompute(templateOne);
          }
        });
      }
    );
    //....
    Promise.all(parentPromises)
      .then(
        (resultBulkCompute) => {
          if (
            resultBulkCompute !== undefined &&
            resultBulkCompute !== null &&
            resultBulkCompute.length > 0
          ) {
            let _GLOBAL_OBJECT = {
              header: {
                remaining_commission: 0,
                remaining_due_to_driver: 0,
                currency: null,
                scheduled_payment_date: null,
              },
              weeks_view: [],
              recordHolder: {}, //! Responsible for holding a record map, to quickly check if the object for a specific week was already generated.
            };

            let parentPromises2 = resultBulkCompute.map((weekData, index) => {
              return new Promise((resComputePack) => {
                //? FORM THE WEEK VIEW - GLOBAL FOR THE WEEK NUMBER
                //Only regenerate new object if new week detected
                if (
                  _GLOBAL_OBJECT.recordHolder[`${weekData.week_number}`] !==
                    undefined &&
                  _GLOBAL_OBJECT.recordHolder[`${weekData.week_number}`] !==
                    null &&
                  _GLOBAL_OBJECT.recordHolder[`${weekData.week_number}`]
                    .year === weekData.year_number &&
                  _GLOBAL_OBJECT.recordHolder[`${weekData.week_number}`]
                    .week === weekData.week_number
                ) {
                  //Week obj already generated - JUST Update
                  let savedRecordOBJ =
                    _GLOBAL_OBJECT.weeks_view[
                      _GLOBAL_OBJECT.recordHolder[`${weekData.week_number}`]
                        .index
                    ];
                  savedRecordOBJ.total_earning += parseFloat(
                    weekData.earning_amount
                  ); //Cash and wallet
                  savedRecordOBJ.total_earning_wallet +=
                    weekData.earning_amount_wallet; //Only wallet
                  savedRecordOBJ.total_rides += weekData.total_rides;
                  savedRecordOBJ.total_deliveries += weekData.total_deliveries;
                  savedRecordOBJ.total_taxiconnect_commission +=
                    weekData.taxiconnect_commission;
                  savedRecordOBJ.total_earning_due_to_driver +=
                    Math.floor(
                      (weekData.earning_due_to_driver + Number.EPSILON) * 100
                    ) / 100;
                  savedRecordOBJ.total_earning_due_to_driver_cash +=
                    Math.floor(
                      (weekData.earning_due_to_driver_CASH + Number.EPSILON) *
                        100
                    ) / 100;
                  savedRecordOBJ.driver_weekly_payout +=
                    weekData.driver_weekly_payout;
                  //Update the correct day of the week
                  let dayNameIndex = /^mon/i.test(weekData.day_name)
                    ? "monday"
                    : /^tu/i.test(weekData.day_name)
                    ? "tuesday"
                    : /^wed/i.test(weekData.day_name)
                    ? "wednesday"
                    : /^thu/i.test(weekData.day_name)
                    ? "thursday"
                    : /^fri/i.test(weekData.day_name)
                    ? "friday"
                    : /^sat/i.test(weekData.day_name)
                    ? "saturday"
                    : "sunday";
                  //.....
                  savedRecordOBJ.daily_earning[dayNameIndex].requests +=
                    weekData.total_rides + weekData.total_deliveries;
                  savedRecordOBJ.daily_earning[dayNameIndex].earning +=
                    Math.floor(
                      (weekData.earning_amount + Number.EPSILON) * 100
                    ) / 100;
                  //! DONE - UPDATE SAVED OBJECT
                  _GLOBAL_OBJECT.weeks_view[
                    _GLOBAL_OBJECT.recordHolder[`${weekData.week_number}`].index
                  ] = savedRecordOBJ;
                  //...
                  resComputePack(true);
                } //No obj generated yet - create a fresh one
                else {
                  let weekTemplate = {
                    id: index + 1,
                    week_number: weekData.week_number,
                    year_number: weekData.year_number,
                    total_earning: parseFloat(weekData.earning_amount), //Cash and wallet included
                    total_earning_wallet: weekData.earning_amount_wallet, //Without commission removal - wallet amount
                    total_rides: weekData.total_rides,
                    total_deliveries: weekData.total_deliveries,
                    total_taxiconnect_commission:
                      weekData.taxiconnect_commission,
                    total_earning_due_to_driver:
                      Math.floor(
                        (weekData.earning_due_to_driver + Number.EPSILON) * 100
                      ) / 100, //With comission removal
                    total_earning_due_to_driver_cash:
                      Math.floor(
                        (weekData.earning_due_to_driver_CASH + Number.EPSILON) *
                          100
                      ) / 100, //For cash
                    driver_weekly_payout: weekData.driver_weekly_payout,
                    scheduled_payment_date: null, //! VERY IMPORTANT - for information
                    daily_earning: {
                      monday: {
                        requests: /^mon/i.test(weekData.day_name)
                          ? weekData.total_rides + weekData.total_deliveries
                          : 0,
                        earning: /^mon/i.test(weekData.day_name)
                          ? weekData.earning_amount
                          : 0,
                      },
                      tuesday: {
                        requests: /^tu/i.test(weekData.day_name)
                          ? weekData.total_rides + weekData.total_deliveries
                          : 0,
                        earning: /^tu/i.test(weekData.day_name)
                          ? weekData.earning_amount
                          : 0,
                      },
                      wednesday: {
                        requests: /^wed/i.test(weekData.day_name)
                          ? weekData.total_rides + weekData.total_deliveries
                          : 0,
                        earning: /^wed/i.test(weekData.day_name)
                          ? weekData.earning_amount
                          : 0,
                      },
                      thursday: {
                        requests: /^thu/i.test(weekData.day_name)
                          ? weekData.total_rides + weekData.total_deliveries
                          : 0,
                        earning: /^thu/i.test(weekData.day_name)
                          ? weekData.earning_amount
                          : 0,
                      },
                      friday: {
                        requests: /^fri/i.test(weekData.day_name)
                          ? weekData.total_rides + weekData.total_deliveries
                          : 0,
                        earning: /^fri/i.test(weekData.day_name)
                          ? weekData.earning_amount
                          : 0,
                      },
                      saturday: {
                        requests: /^sat/i.test(weekData.day_name)
                          ? weekData.total_rides + weekData.total_deliveries
                          : 0,
                        earning: /^sat/i.test(weekData.day_name)
                          ? weekData.earning_amount
                          : 0,
                      },
                      sunday: {
                        requests: /^sun/i.test(weekData.day_name)
                          ? weekData.total_rides + weekData.total_deliveries
                          : 0,
                        earning: /^sun/i.test(weekData.day_name)
                          ? weekData.earning_amount
                          : 0,
                      },
                    }, //? Weeekly earning include cash and wallet amounts
                  };
                  //...Done initiallizing - SAVE
                  //! 1. Update the record holder
                  _GLOBAL_OBJECT.recordHolder[`${weekData.week_number}`] = {
                    index: index,
                    year: weekData.year_number, //? Very important - gather based on the years as well
                    week: weekData.week_number, //? Very important - gather based on the weeks of the years as well
                  };
                  //! 2. Update the week view following the index order
                  _GLOBAL_OBJECT.weeks_view[index] = weekTemplate;
                  resComputePack(true);
                }
              });
            });
            //....DOne
            Promise.all(parentPromises2)
              .then(
                (resultGlobalData) => {
                  if (resultGlobalData.length > 0) {
                    _GLOBAL_OBJECT["transactions_data"] =
                      walletBasicData.transactions_data; //! Add the transaction data
                    //Has some data
                    //Remove empty objects, false, null or undefined
                    _GLOBAL_OBJECT.weeks_view =
                      _GLOBAL_OBJECT.weeks_view.filter(
                        (data) =>
                          Object.keys(data).length > 0 &&
                          data !== undefined &&
                          data !== false &&
                          data !== null
                      );
                    //? Compute the global remaining comission for TaxiConnect
                    let totalEarnings = 0;
                    let totalDues = 0;
                    let totalDues_wallet = 0;
                    let totalPayouts = 0;
                    let totalComission = 0;
                    _GLOBAL_OBJECT.weeks_view.map((weekData) => {
                      totalEarnings += weekData.total_earning; //Money made
                      totalDues +=
                        weekData.total_earning_due_to_driver +
                        weekData.total_earning_due_to_driver_cash; //Money due - WALLET AND CASH
                      totalDues_wallet += weekData.total_earning_due_to_driver; //Only dues for the wallet
                      totalPayouts += weekData.driver_weekly_payout; //Money already transaferred.
                      totalComission += weekData.total_taxiconnect_commission; //Comission already transferred to US
                    });
                    logger.info(`
                      Total earnings : ${totalEarnings}\n
                      Total dues : ${totalDues}\n
                      Total dues wallet : ${totalDues_wallet}\n
                      Total payouts : ${totalPayouts}\n
                      Total comission : ${totalComission}
                    `);
                    //...
                    //! General left comission
                    _GLOBAL_OBJECT.header.remaining_commission =
                      Math.ceil(
                        (totalEarnings -
                          totalDues -
                          totalComission +
                          Number.EPSILON) *
                          100
                      ) / 100;
                    //! General left due to driver
                    _GLOBAL_OBJECT.header.remaining_due_to_driver =
                      Math.floor(
                        (totalDues_wallet - totalPayouts + Number.EPSILON) * 100
                      ) / 100;
                    //! Attatch a currency
                    _GLOBAL_OBJECT.header.currency =
                      process.env.PAYMENT_CURRENCY;
                    //! Attach the NEXT PAYMENT DATE.
                    new Promise((resFindNexyPayoutDate) => {
                      resolveDate(); //! Update the date
                      //? Find the last payout and from there - compute the next one
                      collectionWalletTransactions_logs
                        .find({
                          transaction_nature: "startingPoint_forFreshPayouts",
                          recipient_fp: driver_fingerprint,
                        })
                        .collation({ locale: "en", strength: 2 })
                        .toArray(function (err, resultLastPayout) {
                          if (err) {
                            resFindNexyPayoutDate(false);
                          }
                          //...
                          if (
                            resultLastPayout !== undefined &&
                            resultLastPayout.length > 0 &&
                            resultLastPayout[0].date_captured !== undefined
                          ) {
                            let lastPayoutDate = new Date(
                              resultLastPayout[0].date_captured
                            );
                            resFindNexyPayoutDate(lastPayoutDate);
                          } //? The driver was never paid before
                          else {
                            //!Check if a reference point exists - if not set one to NOW
                            //! Annotation string: startingPoint_forFreshPayouts
                            collectionWalletTransactions_logs
                              .find({
                                flag_annotation:
                                  "startingPoint_forFreshPayouts",
                                user_fingerprint: driver_fingerprint,
                              })
                              .collation({ locale: "en", strength: 2 })
                              .toArray(function (err, referenceData) {
                                if (err) {
                                  resFindNexyPayoutDate(false);
                                }
                                //...
                                if (
                                  referenceData !== undefined &&
                                  referenceData.length > 0 &&
                                  referenceData[0].date_captured !== undefined
                                ) {
                                  //Found an existing annotation - use the date as starting point
                                  let lastPayoutDate = new Date(
                                    referenceData[0].date_captured
                                  );
                                  //..
                                  resFindNexyPayoutDate(lastPayoutDate);
                                } //No annotation yet - create one
                                else {
                                  collectionWalletTransactions_logs.insertOne(
                                    {
                                      flag_annotation:
                                        "startingPoint_forFreshPayouts",
                                      user_fingerprint: driver_fingerprint,
                                      date_captured: chaineDateUTC,
                                    },
                                    function (err, reslt) {
                                      let lastPayoutDate = new Date(
                                        new Date(chaineDateUTC).getTime() +
                                          parseFloat(
                                            process.env
                                              .TAXICONNECT_PAYMENT_FREQUENCY
                                          ) *
                                            24 *
                                            3600000
                                      );
                                      //..
                                      resFindNexyPayoutDate(lastPayoutDate);
                                    }
                                  );
                                }
                              });
                          }
                        });
                    })
                      .then(
                        (resultPayoutDate) => {
                          if (resultPayoutDate !== false) {
                            //? Update the next payout date var
                            _GLOBAL_OBJECT.header.scheduled_payment_date =
                              resultPayoutDate;
                            //! Cache data --- ~ min
                            redisCluster.set(
                              redisKey,
                              stringify(_GLOBAL_OBJECT)
                            );
                            resolve(_GLOBAL_OBJECT);
                          } //Couldn't find a payout date
                          else {
                            resolve({
                              header: null,
                              weeks_view: null,
                              response: "error",
                            });
                          }
                        },
                        (error) => {
                          logger.info(error);
                          resolve({
                            header: null,
                            weeks_view: null,
                            response: "error",
                          });
                        }
                      )
                      .catch((error) => {
                        logger.info(error);
                        resolve({
                          header: null,
                          weeks_view: null,
                          response: "error",
                        });
                      });
                  } //No data
                  else {
                    resolve({
                      header: null,
                      weeks_view: null,
                    });
                  }
                },
                (error) => {
                  logger.info(error);
                  resolve({
                    header: null,
                    weeks_view: null,
                    response: "error",
                  });
                }
              )
              .catch((error) => {
                logger.info(error);
                resolve({
                  header: null,
                  weeks_view: null,
                  response: "error",
                });
              });
          } //Empty records
          else {
            resolve({
              header: null,
              weeks_view: null,
            });
          }
        },
        (error) => {
          logger.info(error);
          resolve({
            header: null,
            weeks_view: null,
            response: "error",
          });
        }
      )
      .catch((error) => {
        logger.info(error);
        resolve({
          header: null,
          weeks_view: null,
          response: "error",
        });
      });
  } //No transactions
  else {
    //! Attach the NEXT PAYMENT DATE.
    new Promise((resFindNexyPayoutDate) => {
      resolveDate(); //! Update the date
      //? Find the last payout and from there - compute the next one
      collectionWalletTransactions_logs
        .find({
          transaction_nature: "weeklyPaidDriverAutomatic",
          recipient_fp: driver_fingerprint,
        })
        .collation({ locale: "en", strength: 2 })
        .toArray(function (err, resultLastPayout) {
          if (err) {
            resFindNexyPayoutDate(false);
          }
          //...
          if (
            resultLastPayout !== undefined &&
            resultLastPayout.length > 0 &&
            resultLastPayout[0].date_captured !== undefined
          ) {
            //Found the llast payout date
            //! Do not update the payment date cycle
            let lastPayoutDate = new Date(resultLastPayout[0].date_captured);
            //....
            resFindNexyPayoutDate(lastPayoutDate);
          } //? The driver was never paid before
          else {
            //!Check if a reference point exists - if not set one to NOW
            //! Annotation string: startingPoint_forFreshPayouts
            collectionWalletTransactions_logs
              .find({
                flag_annotation: "startingPoint_forFreshPayouts",
                user_fingerprint: driver_fingerprint,
              })
              .collation({ locale: "en", strength: 2 })
              .toArray(function (err, referenceData) {
                if (err) {
                  resFindNexyPayoutDate(false);
                }
                //...
                if (
                  referenceData !== undefined &&
                  referenceData.length > 0 &&
                  referenceData[0].date_captured !== undefined
                ) {
                  //Found an existing annotation - use the date as starting point
                  //! Do not update the payment date cycle
                  let lastPayoutDate = new Date(
                    new Date(referenceData[0].date_captured)
                  );
                  //..
                  resFindNexyPayoutDate(lastPayoutDate);
                } //No annotation yet - create one
                else {
                  collectionWalletTransactions_logs.insertOne(
                    {
                      flag_annotation: "startingPoint_forFreshPayouts",
                      user_fingerprint: driver_fingerprint,
                      date_captured: chaineDateUTC,
                    },
                    function (err, reslt) {
                      let lastPayoutDate = new Date(
                        new Date(chaineDateUTC).getTime() +
                          process.env.TAXICONNECT_PAYMENT_FREQUENCY *
                            24 *
                            3600000
                      );
                      //..
                      resFindNexyPayoutDate(lastPayoutDate);
                    }
                  );
                }
              });
          }
        });
    })
      .then(
        (resultPayoutDate) => {
          if (resultPayoutDate !== false) {
            let _GLOBAL_OBJECT = {
              header: {
                scheduled_payment_date: null,
              },
              weeks_view: null,
            };
            //? Update the next payout date var
            _GLOBAL_OBJECT.header.scheduled_payment_date = resultPayoutDate;
            //! Cache data --- ~ min
            redisCluster.set(redisKey, stringify(_GLOBAL_OBJECT));
            //....
            resolve(_GLOBAL_OBJECT);
          } //Couldn't find a payout date
          else {
            resolve({
              header: null,
              weeks_view: null,
              response: "error",
            });
          }
        },
        (error) => {
          logger.info(error);
          resolve({
            header: null,
            weeks_view: null,
            response: "error",
          });
        }
      )
      .catch((error) => {
        logger.info(error);
        resolve({
          header: null,
          weeks_view: null,
          response: "error",
        });
      });
  }
}

/**
 * @func ucFirst
 * Responsible to uppercase only the first character and lowercase the rest.
 * @param stringData: the string to be processed.
 */
function ucFirst(stringData) {
  try {
    return `${stringData[0].toUpperCase()}${stringData
      .substr(1)
      .toLowerCase()}`;
  } catch (error) {
    logger.info(error);
    return stringData;
  }
}

/**
 * @func EmailValidator
 * Responsible for performing a shallow syntaxic validation of an email string.
 * @param emailString: the email string to be checked.
 */
function EmailValidator(emailString) {
  let reg = /^\w+([\.-]?\w+)*@\w+([\.-]?\w+)*(\.\w{2,3})+$/;
  if (reg.test(emailString) === false) {
    return false;
  } else {
    return true;
  }
}

/**
 * @func updateRiders_generalProfileInfos
 * Responsible for dealing with the updates of all the riders profile information,
 * and can log all the changes to the general events log.
 * @param collectionPassengers_profiles: passengers profiles.
 * @param collectionGlobalEvents: contains all the events.
 * @param collection_OTP_dispatch_map: contains all the OTPs, useful for numbers change.
 * @param requestData: contains the user fingerprint, the wanted info to be changed and the relevant data -name, surname, picture, email, phone number, gender - (SHOULD BE CHECKED)
 */
function updateRiders_generalProfileInfos(
  collectionPassengers_profiles,
  collection_OTP_dispatch_map,
  collectionGlobalEvents,
  requestData,
  resolve
) {
  resolveDate();
  //...
  if (requestData.infoToUpdate === "name") {
    //Modify the name
    if (requestData.dataToUpdate.length > 2) {
      //Acceptable
      let filter = {
        user_fingerprint: requestData.user_fingerprint,
      };
      let updateData = {
        $set: {
          name: ucFirst(requestData.dataToUpdate),
          last_updated: new Date(chaineDateUTC),
        },
      };
      //..
      //1. Get the old data
      collectionPassengers_profiles
        .find(filter)
        .toArray(function (err, riderProfile) {
          if (err) {
            res.send({ response: "error", flag: "unexpected_error" });
          }
          //2. Update the new data
          collectionPassengers_profiles.updateOne(
            filter,
            updateData,
            function (err, result) {
              if (err) {
                res.send({ response: "error", flag: "unexpected_error" });
              }
              //...Update the general event log
              new Promise((res) => {
                let dataEvent = {
                  event_name: "rider_name_update",
                  user_fingerprint: requestData.user_fingerprint,
                  old_data: riderProfile[0].name,
                  new_data: requestData.dataToUpdate,
                  date: new Date(chaineDateUTC),
                };
                collectionGlobalEvents.insertOne(
                  dataEvent,
                  function (err, reslt) {
                    res(true);
                  }
                );
              }).then(
                () => {},
                () => {}
              );
              //...
              resolve({ response: "success", flag: "operation successful" });
            }
          );
        });
    } //Name too short
    else {
      resolve({ response: "error", flag: "The name's too short." });
    }
  } else if (requestData.infoToUpdate === "surname") {
    //Modify the surname
    if (requestData.dataToUpdate.length > 2) {
      //Acceptable
      let filter = {
        user_fingerprint: requestData.user_fingerprint,
      };
      let updateData = {
        $set: {
          surname: ucFirst(requestData.dataToUpdate),
          last_updated: new Date(chaineDateUTC),
        },
      };
      //..
      //1. Get the old data
      collectionPassengers_profiles
        .find(filter)
        .toArray(function (err, riderProfile) {
          if (err) {
            res.send({ response: "error", flag: "unexpected_error" });
          }
          //2. Update the new data
          collectionPassengers_profiles.updateOne(
            filter,
            updateData,
            function (err, result) {
              if (err) {
                res.send({ response: "error", flag: "unexpected_error" });
              }
              //...Update the general event log
              new Promise((res) => {
                let dataEvent = {
                  event_name: "rider_surname_update",
                  user_fingerprint: requestData.user_fingerprint,
                  old_data: riderProfile[0].surname,
                  new_data: requestData.dataToUpdate,
                  date: new Date(chaineDateUTC),
                };
                collectionGlobalEvents.insertOne(
                  dataEvent,
                  function (err, reslt) {
                    res(true);
                  }
                );
              }).then(
                () => {},
                () => {}
              );
              //...
              resolve({ response: "success", flag: "operation successful" });
            }
          );
        });
    } //Name too short
    else {
      resolve({ response: "error", flag: "The surname's too short." });
    }
  } else if (requestData.infoToUpdate === "gender") {
    //? Update the gender's string to M, F or unknown
    requestData.dataToUpdate = /^male$/i.test(requestData.dataToUpdate.trim())
      ? "M"
      : /^female$/i.test(requestData.dataToUpdate.trim())
      ? "F"
      : "unknown";
    //Modify the gender
    if (
      requestData.dataToUpdate.length > 0 &&
      ["M", "F", "unknown"].includes(requestData.dataToUpdate)
    ) {
      //Acceptable
      let filter = {
        user_fingerprint: requestData.user_fingerprint,
      };
      let updateData = {
        $set: {
          gender: requestData.dataToUpdate.toUpperCase(),
          last_updated: new Date(chaineDateUTC),
        },
      };
      //..
      //1. Get the old data
      collectionPassengers_profiles
        .find(filter)
        .toArray(function (err, riderProfile) {
          if (err) {
            res.send({ response: "error", flag: "unexpected_error" });
          }
          //2. Update the new data
          collectionPassengers_profiles.updateOne(
            filter,
            updateData,
            function (err, result) {
              if (err) {
                res.send({ response: "error", flag: "unexpected_error" });
              }
              //...Update the general event log
              new Promise((res) => {
                let dataEvent = {
                  event_name: "rider_gender_update",
                  user_fingerprint: requestData.user_fingerprint,
                  old_data: riderProfile[0].gender,
                  new_data: requestData.dataToUpdate,
                  date: new Date(chaineDateUTC),
                };
                collectionGlobalEvents.insertOne(
                  dataEvent,
                  function (err, reslt) {
                    res(true);
                  }
                );
              }).then(
                () => {},
                () => {}
              );
              //...
              resolve({ response: "success", flag: "operation successful" });
            }
          );
        });
    } //Invalid gender
    else {
      resolve({ response: "error", flag: "Invalid gender" });
    }
  } else if (requestData.infoToUpdate === "email") {
    //Modify the email
    if (
      requestData.dataToUpdate.length > 1 &&
      EmailValidator(requestData.dataToUpdate)
    ) {
      //Acceptable
      let filter = {
        user_fingerprint: requestData.user_fingerprint,
      };
      let updateData = {
        $set: {
          email: requestData.dataToUpdate.trim().toLowerCase(),
          last_updated: new Date(chaineDateUTC),
        },
      };
      //..
      //1. Get the old data
      collectionPassengers_profiles
        .find(filter)
        .toArray(function (err, riderProfile) {
          if (err) {
            res.send({ response: "error", flag: "unexpected_error" });
          }
          //2. Update the new data
          collectionPassengers_profiles.updateOne(
            filter,
            updateData,
            function (err, result) {
              if (err) {
                res.send({ response: "error", flag: "unexpected_error" });
              }
              //...Update the general event log
              new Promise((res) => {
                let dataEvent = {
                  event_name: "rider_email_update",
                  user_fingerprint: requestData.user_fingerprint,
                  old_data: riderProfile[0].email.trim().toLowerCase(),
                  new_data: requestData.dataToUpdate,
                  date: new Date(chaineDateUTC),
                };
                collectionGlobalEvents.insertOne(
                  dataEvent,
                  function (err, reslt) {
                    res(true);
                  }
                );
              }).then(
                () => {},
                () => {}
              );
              //...
              resolve({ response: "success", flag: "operation successful" });
            }
          );
        });
    } //Invalid email
    else {
      resolve({ response: "error", flag: "The email looks wrong." });
    }
  } else if (requestData.infoToUpdate === "phone") {
    if (requestData.direction === "initChange") {
      logger.info("Initialize the phone number change");
      //Modify the surname
      if (requestData.dataToUpdate.length > 7) {
        //Check the phone number by sending an OTP
        let url =
          process.env.LOCAL_URL +
          ":" +
          process.env.ACCOUNTS_SERVICE_PORT +
          "/sendOTPAndCheckUserStatus?phone_number=" +
          requestData.dataToUpdate +
          "&user_fingerprint=" +
          requestData.user_fingerprint +
          "&smsHashLinker=" +
          requestData.smsHashLinker;

        requestAPI(url, function (error, response, body) {
          if (error === null) {
            try {
              body = JSON.parse(body);
              resolve(body);
            } catch (error) {
              resolve({
                response: "error",
                flag: "error_checking_user",
              });
            }
          } else {
            resolve({
              response: "error",
              flag: "error_checking_user",
            });
          }
        });
      } //Phonw too short
      else {
        resolve({ response: "error", flag: "The phone number looks wrong." });
      }
    } else if (requestData.direction === "confirmChange") {
      let url =
        process.env.LOCAL_URL +
        ":" +
        process.env.ACCOUNTS_SERVICE_PORT +
        "/checkSMSOTPTruly?phone_number=" +
        requestData.dataToUpdate +
        "&otp=" +
        requestData.otp +
        "&userType=registered&user_fingerprint=" +
        requestData.user_fingerprint;

      requestAPI(url, function (error, response, body) {
        logger.info(body);
        if (error === null) {
          try {
            body = JSON.parse(body);
            if (
              body.response !== undefined &&
              body.response !== null &&
              body.response
            ) {
              //Verified
              logger.info("NUMBER VERIFIEDD!");
              //Acceptable
              let filter = {
                user_fingerprint: requestData.user_fingerprint,
              };
              let updateData = {
                $set: {
                  phone_number: /^\+/i.test(requestData.dataToUpdate.trim())
                    ? requestData.dataToUpdate.trim()
                    : `+${requestData.dataToUpdate.trim()}`,
                  last_updated: new Date(chaineDateUTC),
                },
              };
              //..
              //1. Get the old data
              collectionPassengers_profiles
                .find(filter)
                .toArray(function (err, riderProfile) {
                  if (err) {
                    res.send({ response: "error", flag: "unexpected_error" });
                  }
                  //2. Update the new data
                  collectionPassengers_profiles.updateOne(
                    filter,
                    updateData,
                    function (err, result) {
                      if (err) {
                        res.send({
                          response: "error",
                          flag: "unexpected_error",
                        });
                      }
                      //...Update the general event log
                      new Promise((res) => {
                        let dataEvent = {
                          event_name: "rider_phone_update",
                          user_fingerprint: requestData.user_fingerprint,
                          old_data: riderProfile[0].phone_number,
                          new_data: requestData.dataToUpdate,
                          date: new Date(chaineDateUTC),
                        };
                        collectionGlobalEvents.insertOne(
                          dataEvent,
                          function (err, reslt) {
                            res(true);
                          }
                        );
                      }).then(
                        () => {},
                        () => {}
                      );
                      //...
                      resolve({
                        response: "success",
                        flag: "operation successful",
                      });
                    }
                  );
                });
            } //Error
            else {
              resolve({
                response: "error",
                flag: "error_checking_otp",
              });
            }
          } catch (error) {
            resolve({
              response: "error",
              flag: "error_checking_otp",
            });
          }
        } else {
          resolve({
            response: "error",
            flag: "error_checking_otp",
          });
        }
      });
    } //Invalid data
    else {
      resolve({ response: "error", flag: "invalid_data_direction" });
    }
  } else if (requestData.infoToUpdate === "picture") {
    try {
      if (isBase64(requestData.dataToUpdate, { mimeRequired: true })) {
        //Valid base64
        //? The @param dataToUpdate MUST contain the base64 of the profille picture.
        //? picture name format: user_fingerprint +_+ timestamp + format
        let buffer = Buffer.from(requestData.dataToUpdate, "base64");
        let tmpDate = new Date();
        //!get the image format from the base64 code
        let formatImg = requestData.dataToUpdate
          .split(";")[0]
          .split(`/`)[1]
          .trim()
          .toLowerCase();
        let tmpPicture_name = `${requestData.user_fingerprint}_${Math.round(
          tmpDate.getTime()
        )}.${formatImg}`;
        //...
        let regCleaner = new RegExp(`data:image/${formatImg};base64,`, "i");
        requestData.dataToUpdate = requestData.dataToUpdate.replace(
          regCleaner,
          ""
        );
        //Save the image
        let fileName_andPath = `${process.env.RIDERS_PROFILE_PICTURES_PATH.replace(
          /\//g,
          ""
        )}/${tmpPicture_name}`;
        fs.writeFile(
          fileName_andPath,
          requestData.dataToUpdate,
          "base64",
          function (err) {
            if (err) {
              resolve({
                response: "error",
                flag: "unexpected_conversion_error_1",
              });
            }
            //! UPLOAD THE PICTURE TO S3 - Promisify!
            new Promise((resUploadPic_toS3) => {
              // Read content from the file
              const fileContentUploaded_locally =
                fs.readFileSync(fileName_andPath);

              // Setting up S3 upload parameters
              const params = {
                Bucket: `${process.env.AWS_S3_RIDERS_BUCKET_NAME}/Profiles_pictures`,
                Key: tmpPicture_name, // File name you want to save as in S3
                Body: fileContentUploaded_locally,
              };

              // Uploading files to the bucket
              s3.upload(params, function (err, data) {
                if (err) {
                  logger.info(err);
                  resUploadPic_toS3(false);
                }
                logger.info(`Riders profile picture uploaded successfully.`);
                resUploadPic_toS3(true);
              });
            })
              .then(
                (resultS3_upload) => {
                  if (resultS3_upload) {
                    //? Was successfullly upload to S3
                    //Done - update mongodb
                    let updatedData = {
                      $set: {
                        "media.profile_picture": tmpPicture_name,
                      },
                    };
                    //...
                    collectionPassengers_profiles.updateOne(
                      { user_fingerprint: requestData.user_fingerprint },
                      updatedData,
                      function (err, reslt) {
                        if (err) {
                          resolve({
                            response: "error",
                            flag: "unexpected_conversion_error_",
                          });
                        }
                        //...Update the general event log
                        new Promise((res) => {
                          collectionPassengers_profiles
                            .find({
                              user_fingerprint: requestData.user_fingerprint,
                            })
                            .toArray(function (error, riderData) {
                              if (error) {
                                res(false);
                              }
                              //...
                              if (riderData.length > 0) {
                                //Valid
                                let dataEvent = {
                                  event_name: "rider_profile_picture_update",
                                  user_fingerprint:
                                    requestData.user_fingerprint,
                                  old_data: riderData[0].media.profile_picture,
                                  new_data: tmpPicture_name,
                                  date: new Date(chaineDateUTC),
                                };
                                collectionGlobalEvents.insertOne(
                                  dataEvent,
                                  function (err, reslt) {
                                    res(true);
                                  }
                                );
                              } //No riders with the providedd fingerprint
                              else {
                                res(false);
                              }
                            });
                        }).then(
                          () => {},
                          () => {}
                        );
                        //...
                        //DONE
                        resolve({
                          response: "success",
                          flag: "operation successful",
                          picture_name: `${process.env.AWS_S3_RIDERS_PROFILE_PICTURES_PATH}/${tmpPicture_name}`,
                        });
                      }
                    );
                  } //! Was unable to upload to S3 - conversion error
                  else {
                    resolve({
                      response: "error",
                      flag: "unexpected_conversion_error_1",
                    });
                  }
                },
                (error) => {
                  logger.info(error);
                  resolve({
                    response: "error",
                    flag: "unexpected_conversion_error_1",
                  });
                }
              )
              .catch((error) => {
                logger.info(error);
                resolve({
                  response: "error",
                  flag: "unexpected_conversion_error_1",
                });
              });
          }
        );
      } //No mime found
      else {
        resolve({
          response: "error",
          flag: "unexpected_conversion_error_no_mime",
        });
      }
    } catch (error) {
      logger.info(error);
      resolve({ response: "error", flag: "unexpected_conversion_error" });
    }
  }
  //Error - invalid data
  else {
    resolve({ response: "error", flag: "invalid_data" });
  }
}

/**
 * @func getDriver_onlineOffline_status
 * GET DRIVER ONLINE OR OFFLINE STATUS
 * Responsible for getting the driver's online or offline status.
 * @param req: request generic data
 * @param resolve
 */
function getDriver_onlineOffline_status(req, resolve) {
  //Get information about the state
  new Promise((res0) => {
    collectionDrivers_profiles
      .find({ driver_fingerprint: req.driver_fingerprint })
      .toArray(function (err, driverData) {
        if (err) {
          logger.info(err);
          res0({ response: "error_invalid_request" });
        }
        //...
        if (
          driverData !== undefined &&
          driverData !== null &&
          driverData[0] !== undefined &&
          driverData[0] !== null &&
          driverData[0].operational_state !== undefined &&
          driverData[0].operational_state !== null &&
          driverData.length > 0
        ) {
          //! GET THE SUSPENSION INFOS
          let suspensionInfos = {
            is_suspended:
              driverData[0].isDriverSuspended !== undefined &&
              driverData[0].isDriverSuspended !== null
                ? driverData[0].isDriverSuspended
                : false,
            message:
              driverData[0].suspension_infos !== undefined &&
              driverData[0].suspension_infos !== null
                ? /UNPAID_COMISSION/i.test(
                    driverData[0].suspension_infos[
                      driverData[0].suspension_infos.length - 1
                    ].reason
                  )
                  ? `Your account has been suspended to an overdue TaxiConnect commission.`
                  : false
                : false,
          };
          //! ------------------------
          driverData = driverData[0];
          //Valid driver
          res0({
            response: "successfully_got",
            flag: driverData.operational_state.status,
            suspension_infos: suspensionInfos,
          });
        } //Unknown driver
        else {
          //res0({ response: "error_invalid_request" });
          res0({
            response: "successfully_got",
            flag: driverData.operational_state.status,
          });
        }
      });
  }).then(
    (result) => {
      resolve(result);
    },
    (error) => {
      logger.info(error);
      resolve({ response: "error_invalid_request" });
    }
  );
}

/**
 * @func getAdsManagerRunningInfos
 * Responsible for getting the only visible Ad based on the city.
 * @param req: input data from the user (must include for sure the user's fingerprint and the user's nature and the city)
 * @param resolve
 * ? Visibility true means that there is a campaign going on.
 */
function getAdsManagerRunningInfos(req, resolve) {
  resolveDate();
  let redisKey = `${req.user_fingerprint}-${req.city}-adDisplayable`;
  redisGet(redisKey).then(
    (resp) => {
      if (resp !== null) {
        try {
          //? Rehydrate data
          new Promise((resExec) => {
            TrulyGetAdsManagerRunningInfos(req, redisKey, resExec);
          })
            .then(
              () => {},
              (error) => {
                logger.info(error);
              }
            )
            .catch((error) => {
              logger.info(error);
            });
          //? Quickly return
          resp = parse(resp);
          resolve(resp);
        } catch (error) {
          logger.info(error);
          //Get fresh record
          new Promise((resExec) => {
            TrulyGetAdsManagerRunningInfos(req, redisKey, resExec);
          })
            .then(
              (result) => {
                resolve(result);
              },
              (error) => {
                logger.info(error);
                resolve({ response: "error", flag: "error_get_data" });
              }
            )
            .catch((error) => {
              logger.info(error);
              resolve({ response: "error", flag: "error_get_data" });
            });
        }
      } //No record - get a fresh one
      else {
        new Promise((resExec) => {
          TrulyGetAdsManagerRunningInfos(req, redisKey, resExec);
        })
          .then(
            (result) => {
              resolve(result);
            },
            (error) => {
              logger.info(error);
              resolve({ response: "error", flag: "error_get_data" });
            }
          )
          .catch((error) => {
            logger.info(error);
            resolve({ response: "error", flag: "error_get_data" });
          });
      }
    },
    (error) => {
      logger.info(error);
      //Get a fresh record
      new Promise((resExec) => {
        TrulyGetAdsManagerRunningInfos(req, redisKey, resExec);
      })
        .then(
          (result) => {
            resolve(result);
          },
          (error) => {
            logger.info(error);
            resolve({ response: "error", flag: "error_get_data" });
          }
        )
        .catch((error) => {
          logger.info(error);
          resolve({ response: "error", flag: "error_get_data" });
        });
    }
  );
  //? Save the GET request for this user.
  new Promise((resSaveRecord) => {
    let eventBundle = {
      event_name: "Ad_GET_event",
      user_fingerprint: req.user_fingerprint,
      user_nature: req.user_nature,
      city: req.city,
      date: new Date(chaineDateUTC),
    };
    //! -----
    collectionGlobalEvents.insertOne(eventBundle, function (err, result) {
      if (err) {
        logger.info(err);
      }
      //...
      resSaveRecord(true);
    });
  }).then(
    () => {},
    () => {}
  );
}

/**
 * @func TrulyGetAdsManagerRunningInfos
 * ! Truly runs the executions
 * Responsible for getting the only visible Ad based on the city.
 * @param req: input data from the user (must include for sure the user's fingerprint and the user's nature and the city)
 * @param redisKey: the redis key to save the data to for 25 min
 * @param resolve
 * ? Visibility true means that there is a campaign going on.
 */
function TrulyGetAdsManagerRunningInfos(req, redisKey, resolve) {
  //?------------------------------------
  //? Get all the companies with visibility "true"
  collectionAdsCompanies_central
    .find({
      visibility: true,
      are_terms_and_conditions_accepted: true,
      "ad_specs.is_expired": false,
      city: req.city,
    })
    .collation({ locale: "en", strength: 2 })
    .toArray(function (err, companiesData) {
      if (err) {
        logger.info(err);
        resolve({ response: "error", flag: "invalid_data" });
      }
      //....
      if (companiesData !== undefined && companiesData.length > 0) {
        //Found some data
        let companyData = companiesData[0];
        //...
        let adsData = companyData.ad_specs.sort((a, b) =>
          a.expiration_date > b.expiration_date
            ? 1
            : b.expiration_date > a.expiration_date
            ? -1
            : 0
        );
        //? Only get the valid campaigns
        adsData = adsData.filter((campaign) =>
          campaign.is_expired === false ? true : false
        );
        //! Rewrite the logo web path
        adsData[0].media.logo = `${process.env.AWS_S3_COMPANIES_AD_DATA_LOGOS}/${adsData[0].media.logo}`;
        //! Remove the dates infos
        adsData[0].date_created = null;
        adsData[0].expiration_date = null;
        //! Add the company id
        adsData[0]["company_id"] = companyData.company_id;
        //? Objectify the data
        adsData = adsData[0];
        //? Cache data
        redisCluster.setex(
          redisKey,
          process.env.REDIS_EXPIRATION_5MIN * 9,
          stringify(adsData)
        );
        //..DONE
        resolve({ response: adsData });
      } //No data
      else {
        redisCluster.setex(
          redisKey,
          process.env.REDIS_EXPIRATION_5MIN * 9,
          stringify({
            response: "No_ad_infos",
          })
        );
        resolve({ response: "No_ad_infos" });
      }
    });
}

/**
 * @func getReferredDrivers_list
 * Responsible for getting the list of all the referred drivers for a specific user.
 * @param requestInfos: all the gets infos
 * @param collectionReferralsInfos: hold all the referrals
 * @param redisKey: the redis key to cache the result to.
 * @param resolve
 */
function getReferredDrivers_list(
  requestInfos,
  collectionReferralsInfos,
  redisKey,
  resolve
) {
  resolveDate();
  let req = requestInfos;
  new Promise((resCompute) => {
    //? 2. Check if there are any referral data
    let finderNarrower = {
      user_referrer: req.user_fingerprint,
      user_referrer_nature: req.user_nature,
    };
    //...
    collectionReferralsInfos
      .find(finderNarrower)
      .collation({ locale: "en", strength: 2 })
      .toArray(function (err, result) {
        if (err) {
          resCompute({ response: "error_unexpected" });
        }
        //...
        if (result !== undefined && result.length > 0) {
          //! Remove irrelevant infos
          result = result.map((itemReferral, index) => {
            try {
              let freshObject = {
                referral_fingerprint: itemReferral.referral_fingerprint,
                taxi_number: itemReferral.taxi_number,
                is_referralExpired: itemReferral.is_referralExpired,
                is_referral_rejected:
                  itemReferral.is_referral_rejected === undefined ||
                  itemReferral.is_referral_rejected === null
                    ? false
                    : itemReferral.is_referral_rejected,
                is_paid: itemReferral.is_paid,
                amount_paid: itemReferral.amount_paid,
                date_referred: new Date(itemReferral.date_referred),
                date_referred_beautified: null,
                time_left: null,
              };
              //? Compute the time left
              let timeLeftRaw =
                new Date(itemReferral.expiration_time) -
                new Date(chaineDateUTC);
              if (timeLeftRaw < 0) {
                freshObject.time_left = "Expired";
              } //Still have some time left
              else {
                timeLeftRaw /= 1000;
                if (timeLeftRaw > 60) {
                  //Change in minutes
                  timeLeftRaw /= 60; //? minutes
                  if (timeLeftRaw > 0) {
                    //Change in hours
                    timeLeftRaw /= 60; //? Hours
                    if (timeLeftRaw > 24) {
                      timeLeftRaw /= 24; //? days
                      //? Change in days
                      timeLeftRaw = Math.round(timeLeftRaw);
                      if (timeLeftRaw > 1) {
                        timeLeftRaw = `${Math.round(timeLeftRaw)} days`;
                      } else {
                        timeLeftRaw = `${Math.round(timeLeftRaw)} day`;
                      }
                    } //Keep in hours
                    else {
                      timeLeftRaw = `${Math.round(timeLeftRaw)} h`;
                    }
                  } //Keep in minutes
                  else {
                    timeLeftRaw = `${Math.round(timeLeftRaw)} min`;
                  }
                } else {
                  timeLeftRaw = `${Math.round(timeLeftRaw)} sec`;
                }
                //............
                freshObject.time_left = timeLeftRaw;
              }
              //...
              freshObject.date_referred_beautified = `${freshObject.date_referred.getDate()}-${
                freshObject.date_referred.getMonth() + 1
              }-${freshObject.date_referred.getFullYear()} at ${freshObject.date_referred.getHours()}:${freshObject.date_referred.getSeconds()}`;
              //...
              return freshObject;
            } catch (error) {
              let freshObject = {
                referral_fingerprint: itemReferral.referral_fingerprint,
                taxi_number: itemReferral.taxi_number,
                is_referralExpired: itemReferral.is_referralExpired,
                is_referral_rejected:
                  itemReferral.is_referral_rejected === undefined ||
                  itemReferral.is_referral_rejected === null
                    ? false
                    : itemReferral.is_referral_rejected,
                is_paid: itemReferral.is_paid,
                amount_paid: itemReferral.amount_paid,
                date_referred: new Date(itemReferral.date_referred),
                date_referred_beautified: null,
                time_left: null,
              };
              //? Compute the time left
              let timeLeftRaw =
                new Date(itemReferral.expiration_time) -
                new Date(chaineDateUTC);
              if (timeLeftRaw < 0) {
                freshObject.time_left = "Expired";
              } //Still have some time left
              else {
                timeLeftRaw /= 1000;
                if (timeLeftRaw > 60) {
                  //Change in minutes
                  timeLeftRaw /= 60; //? minutes
                  if (timeLeftRaw > 0) {
                    //Change in hours
                    timeLeftRaw /= 60; //? Hours
                    if (timeLeftRaw > 24) {
                      timeLeftRaw /= 24; //? days
                      //? Change in days
                      timeLeftRaw = Math.round(timeLeftRaw);
                      if (timeLeftRaw > 1) {
                        timeLeftRaw = `${Math.round(timeLeftRaw)} days`;
                      } else {
                        timeLeftRaw = `${Math.round(timeLeftRaw)} day`;
                      }
                    } //Keep in hours
                    else {
                      timeLeftRaw = `${Math.round(timeLeftRaw)} h`;
                    }
                  } //Keep in minutes
                  else {
                    timeLeftRaw = `${Math.round(timeLeftRaw)} min`;
                  }
                } else {
                  timeLeftRaw = `${Math.round(timeLeftRaw)} sec`;
                }
                //............
                freshObject.time_left = timeLeftRaw;
              }
              //...
              freshObject.date_referred_beautified = `${freshObject.date_referred.getDate()}-${
                freshObject.date_referred.getMonth() + 1
              }-${freshObject.date_referred.getFullYear()} at ${freshObject.date_referred.getHours()}:${freshObject.date_referred.getSeconds()}`;
              //...
              return freshObject;
            }
          });
          //! Sort based on dat
          result = result.sort((a, b) =>
            a.date_referred > b.date_referred
              ? -1
              : b.date_referred > a.date_referred
              ? 1
              : 0
          );
          //! ----
          //? Found some data
          resCompute({
            response: result,
          });
        } //? No referral data found.
        else {
          resCompute({
            response: "no_data",
          });
        }
      });
  })
    .then((result) => {
      //CACHE
      redisCluster.set(redisKey, JSON.stringify(result));
      //-----
      resolve(result);
    })
    .catch((error) => {
      logger.info(error);
      resolve({ response: "error_unexpected" });
    });
}

/**
 * MAIN
 */
var collectionPassengers_profiles = null;
var collectionRidesDeliveryData = null;
var collection_OTP_dispatch_map = null;
var collectionDrivers_profiles = null;
var collectionDrivers_profiles = null;
var collectionGlobalEvents = null;
var collectionWalletTransactions_logs = null;
var collectionAdsCompanies_central = null;
redisCluster.on("connect", function () {
  logger.info("[*] Redis connected");

  clientMongo.connect(function (err) {
    //if (err) throw err;
    logger.info("[+] Account services active.");
    const dbMongo = clientMongo.db(process.env.DB_NAME_MONGODDB);
    collectionPassengers_profiles = dbMongo.collection("passengers_profiles"); //Hold all the passengers profiles
    collectionRidesDeliveryData = dbMongo.collection(
      "rides_deliveries_requests"
    ); //Hold all the requests made (rides and deliveries)
    collection_OTP_dispatch_map = dbMongo.collection("OTP_dispatch_map");
    collectionDrivers_profiles = dbMongo.collection("drivers_profiles"); //Hold all the drivers profiles
    collectionGlobalEvents = dbMongo.collection("global_events"); //Hold all the random events that happened somewhere.
    collectionWalletTransactions_logs = dbMongo.collection(
      "wallet_transactions_logs"
    ); //Hold all the wallet transactions (exlude rides/deliveries records which are in the rides/deliveries collection)
    collectionAdsCompanies_central = dbMongo.collection(
      "ads_companies_central"
    ); //Hold all the companies that subscribed for the Ad program.
    collectionReferralsInfos = dbMongo.collection(
      "referrals_information_global"
    ); //Hold all the referrals infos
    //-------------
    const bodyParser = require("body-parser");
    app
      .get("/", function (req, res) {
        logger.info("Account services up");
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
      .use(helmet());
    //.use(morgan("combined", { stream: accessLogStream }));

    /**
     * GENERATE OTP AND CHECK THE USER EXISTANCE
     * Responsible for generating an otp and checking whether a user was already registered or not.
     * If already registered send also the user fingerprint.
     */
    app.get("/sendOTPAndCheckUserStatus", function (req, res) {
      resolveDate();
      let params = urlParser.parse(req.url, true);
      logger.info(params);
      req = params.query;

      if (
        req.phone_number !== undefined &&
        req.phone_number !== null &&
        req.phone_number.length > 8
      ) {
        req.phone_number = req.phone_number.trim();
        let onlyDigitsPhone = req.phone_number.replace("+", "").trim(); //Critical, should only contain digits
        //Ok
        //! ADD DEBUG TEST DATA -> CODE 88766
        //Send the message then check the passenger's status
        let otp = /856997167/i.test(onlyDigitsPhone)
          ? 88766
          : otpGenerator.generate(5, {
              upperCase: false,
              specialChars: false,
              alphabets: false,
            });
        //! --------------
        //otp = 55576;
        otp = String(otp).length < 5 ? parseInt(otp) * 10 : otp;
        new Promise((res0) => {
          let message = otp + ` is your TaxiConnect Verification Code.`;
          SendSMSTo(onlyDigitsPhone, message);
          res0(true);
          //SMS
        }).then(
          () => {},
          (error) => {
            logger.info(error);
          }
        );

        //1. Check the user's status
        new Promise((res1) => {
          checkUserStatus(
            req,
            otp,
            collection_OTP_dispatch_map,
            collectionPassengers_profiles,
            collectionDrivers_profiles,
            res1
          );
        }).then(
          (result) => {
            //if (!/driver/i.test(req.user_nature)) {
            //! Only send SMS to users or registered drivers
            //2. Generate and SMS the OTP
            /*new Promise((res0) => {
              let message =
                `<#> ` + otp + ` is your TaxiConnect Verification Code.`;
              SendSMSTo(onlyDigitsPhone, message);
              res0(true);
              //SMS
            }).then(
              () => {},
              (error) => {
                logger.info(error);
              }
            );*/
            //}
            //!---------

            //Save otp in profile if the user was already registered
            logger.info(result);
            if (
              result.response !== undefined &&
              result.user_fp !== undefined &&
              result.user_fp !== null
            ) {
              //Registered user
              new Promise((res2) => {
                let secretData = {
                  $set: {
                    "account_verifications.phone_verification_secrets": {
                      otp: parseInt(otp),
                      date_sent: new Date(chaineDateUTC),
                    },
                  },
                };
                //.
                //1. Passengers
                if (
                  req.user_nature === undefined ||
                  req.user_nature === null ||
                  /passenger/i.test(req.user_nature)
                ) {
                  collectionPassengers_profiles.updateOne(
                    { user_fingerprint: result.user_fp },
                    secretData,
                    function (err, reslt) {
                      logger.info(err);
                      res2(true);
                    }
                  );
                } else if (
                  req.user_nature !== undefined &&
                  req.user_nature !== null &&
                  /driver/i.test(req.user_nature)
                ) {
                  //2. Drivers
                  collectionDrivers_profiles.updateOne(
                    { driver_fingerprint: result.user_fp },
                    secretData,
                    function (err, reslt) {
                      logger.info(err);
                      res2(true);
                    }
                  );
                }
              })
                .then(
                  () => {
                    //...
                    res.send(result);
                  },
                  () => {
                    ///....
                    res.send(result);
                  }
                )
                .catch((error) => {
                  ///....
                  res.send(result);
                });
            } else {
              ///....
              res.send(result);
            }
            //...
          },
          (error) => {
            logger.info(error);
            res.send({ response: "error_checking_user" });
          }
        );
      } //Error phone number not received
      else {
        res.send({ response: "error_phone_number_not_received" });
      }
    });

    /**
     * CHECK THAT THE OTP ENTERED BY THE USER IS CORRECT
     * Responsible for checking that the otp entered by the user matches the one generated.
     */
    app.get("/checkSMSOTPTruly", function (req, res) {
      resolveDate();
      let params = urlParser.parse(req.url, true);
      req = params.query;

      if (
        req.phone_number !== undefined &&
        req.phone_number !== null &&
        req.otp !== undefined &&
        req.otp !== null
      ) {
        req.phone_number = req.phone_number.replace("+", "").trim(); //Critical, should only contain digits

        new Promise((res0) => {
          if (/^unregistered$/i.test(req.user_nature.trim())) {
            //Checking for unregistered users
            let checkOTP = {
              phone_number: { $regex: req.phone_number },
              otp: parseInt(req.otp),
            };
            //Check if it exists for this number
            collection_OTP_dispatch_map
              .find(checkOTP)
              .toArray(function (error, result) {
                if (error) {
                  res0({ response: "error_checking_otp" });
                }
                //...
                if (result.length > 0) {
                  //True OTP
                  res0({ response: true });
                } //Wrong otp
                else {
                  res0({ response: false });
                }
              });
          } //Checking for registered user - check the OTP secrets binded to the profile
          else {
            //! Will need the user_fingerprint to be provided.
            //1. Passengers
            if (
              req.user_nature !== undefined &&
              req.user_nature !== null &&
              /passenger/i.test(req.user_nature)
            ) {
              logger.info("Passenger");
              let checkOTP = {
                phone_number: { $regex: req.phone_number },
                "account_verifications.phone_verification_secrets.otp":
                  parseInt(req.otp),
              }; //?Indexed
              //Check if it exists for this number
              collectionPassengers_profiles
                .find(checkOTP)
                .toArray(function (error, result) {
                  if (error) {
                    res0({ response: "error_checking_otp" });
                  }
                  //...
                  if (result.length > 0) {
                    //True OTP
                    res0({ response: true });
                  } //Wrong otp
                  else {
                    res0({ response: true }); //! BUG
                  }
                });
            } else if (
              req.user_nature !== undefined &&
              req.user_nature !== null &&
              /driver/i.test(req.user_nature)
            ) {
              logger.info(req);
              //2. Drivers
              let checkOTP = {
                phone_number: { $regex: req.phone_number },
                "account_verifications.phone_verification_secrets.otp":
                  parseInt(req.otp),
              };
              //Check if it exists for this number
              collectionDrivers_profiles
                .find(checkOTP)
                .toArray(function (error, result) {
                  if (error) {
                    logger.info(error);
                    res0({ response: "error_checking_otp" });
                  }
                  //...
                  if (result.length > 0) {
                    //True OTP
                    res0({ response: true });
                  } //Wrong otp
                  else {
                    res0({ response: false });
                  }
                });
            }
          }
        }).then(
          (reslt) => {
            res.send(reslt);
          },
          (error) => {
            res.send({ response: "error_checking_otp" });
          }
        );
      } //Error - missing details
      else {
        res.send({ response: "error_checking_otp" });
      }
    });

    /**
     * CREATE A NEW ACCOUNT - RIDER
     * Responsible for creating a minimal rider account with only the phone number as an argument.
     */
    app.get("/createMinimalRiderAccount", function (req, res) {
      resolveDate();
      let params = urlParser.parse(req.url, true);
      req = params.query;

      if (req.phone_number !== undefined && req.phone_number !== null) {
        new Promise((res0) => {
          //Generate fingerprint: phone number + date
          new Promise((res1) => {
            generateUniqueFingerprint(
              req.phone_number + chaineDateUTC,
              false,
              res1
            );
          }).then(
            (user_fingerprint) => {
              let minimalAccount = {
                name: "User",
                surname: "",
                gender: "Unknown",
                user_fingerprint: user_fingerprint,
                phone_number: /^\+/.test(req.phone_number)
                  ? req.phone_number
                  : "+" + req.phone_number.trim(),
                email: false,
                password: false,
                account_state: "minimal", //The state of the account in terms of it's creation: minimal or full
                media: {
                  profile_picture: "user.png",
                },
                account_verifications: {
                  is_accountVerified: true, //Account already checked
                  is_policies_accepted: true, //Terms and conditions implicitly accepted
                },
                pushnotif_token:
                  req.pushnotif_token !== undefined &&
                  req.pushnotif_token !== null
                    ? decodeURIComponent(req.pushnotif_token)
                    : false,
                last_updated: {
                  date: new Date(chaineDateUTC),
                },
                date_registered: {
                  date: new Date(chaineDateUTC),
                },
              };
              logger.info(minimalAccount);
              //..
              collectionPassengers_profiles.insertOne(
                minimalAccount,
                function (error, result) {
                  if (error) {
                    res0({ response: "error_creating_account" });
                  }
                  //...Send back the status and fingerprint
                  res0({
                    response: "successfully_created",
                    user_fp: user_fingerprint,
                  });
                }
              );
            },
            (error) => {
              res0({ response: "error_creating_account" });
            }
          );
        }).then(
          (result) => {
            res.send(result);
          },
          (error) => {
            logger.info(error);
            res.send({ response: "error_creating_account" });
          }
        );
      } //Error - missing details
      else {
        res.send({ response: "error_creating_account" });
      }
    });

    /**
     * UDPATE ADDITIONAL DETAILS WHILE CREATING ACCOUNT - RIDER
     * Responsible for updating the rider's profile with the additional profile infos (name, gender and email)
     */
    app.get("/updateAdditionalProfileData_newAccount", function (req, res) {
      resolveDate();
      let params = urlParser.parse(req.url, true);
      req = params.query;

      logger.info(req);

      if (
        req.user_fingerprint !== undefined &&
        req.user_fingerprint !== null &&
        req.name !== undefined &&
        req.name !== null &&
        req.gender !== undefined &&
        req.gender !== null &&
        req.email !== undefined &&
        req.email !== null
      ) {
        req.email = req.email.toLowerCase().trim();
        req.name = req.name.trim();
        //? Split name and surnamme
        let nameHolder = req.name.split(" ");
        req.name = nameHolder[0].trim();
        req.surname = nameHolder.slice(1, 5).join(" ").trim();
        //..
        try {
          new Promise((res0) => {
            let findProfile = {
              user_fingerprint: req.user_fingerprint,
            };
            let updateProfile = {
              $set: {
                name: req.name,
                email: req.email,
                gender: req.gender,
                account_state: "full", //! ADDD ACCOUNT STATE - full
                last_updated: new Date(chaineDateUTC),
              },
            };
            //Update
            collectionPassengers_profiles.updateOne(
              findProfile,
              updateProfile,
              function (error, result) {
                if (error) {
                  logger.info(error);
                  res0({
                    response:
                      "error_adding_additional_profile_details_new_account",
                  });
                }
                //Get the profile details
                collectionPassengers_profiles
                  .find(findProfile)
                  .toArray(function (err, riderProfile) {
                    if (err) {
                      logger.info(err);
                      res0({
                        response:
                          "error_adding_additional_profile_details_new_account",
                      });
                    }
                    logger.info(riderProfile);
                    //...
                    if (riderProfile.length > 0) {
                      //Found something
                      res0({
                        response: "updated",
                        user_fp: riderProfile[0].user_fingerprint,
                        name: riderProfile[0].name,
                        surname: riderProfile[0].surname,
                        gender: riderProfile[0].gender,
                        phone_number: riderProfile[0].phone_number,
                        email: riderProfile[0].email,
                        account_state: "full", //!VERY IMPORTANT - MARK ACCOUNT CREATION STATE AS FULL - to avoid redirection to complete details screen.
                        profile_picture: `${process.env.AWS_S3_RIDERS_PROFILE_PICTURES_PATH}/${riderProfile[0].media.profile_picture}`,
                        pushnotif_token: riderProfile[0].pushnotif_token,
                      });
                    } //Error finding profile
                    else {
                      res0({
                        response:
                          "error_adding_additional_profile_details_new_account",
                      });
                    }
                  });
              }
            );
          }).then(
            (result) => {
              res.send(result);
            },
            (error) => {
              logger.info(error);
              res.send({
                response: "error_adding_additional_profile_details_new_account",
              });
            }
          );
        } catch (error) {
          logger.info(error);
          res.send({
            response: "error_adding_additional_profile_details_new_account",
          });
        }
      }
      //Error - missing details
      else {
        logger.info("missing details");
        res.send({
          response: "error_adding_additional_profile_details_new_account",
        });
      }
    });

    /**
     * GET RIDES HISTORY FOR THE RIDERS
     * Responsible for getting different rides to mainly display in the "Your rides" tab for riders (or drivers?)
     * Past, Scheduled or Business
     * Targeted requests are very usefull when it comes to fetch more details about a SPECIFIC ride (ride fp required!)
     * ride_type: Past (already completed - can include scheduled), Scheduled (upcoming) or Business (with business flag)
     * LIMIT: last 50 rides
     */
    app.get("/getRides_historyRiders", function (req, res) {
      resolveDate();
      let params = urlParser.parse(req.url, true);
      req = params.query;
      logger.info(req);

      if (req.user_fingerprint !== undefined && req.user_fingerprint !== null) {
        //Valid
        if (
          req.target !== undefined &&
          req.target !== null &&
          req.request_fp !== undefined &&
          req.request_fp !== null
        ) {
          //Targeted request
          new Promise((res0) => {
            getBachRidesHistory(
              req,
              collectionRidesDeliveryData,
              collectionDrivers_profiles,
              res0
            );
          }).then(
            (result) => {
              logger.info(result);
              res.send(result);
            },
            (error) => {
              logger.info(error);
              res.send({ response: "error_authentication_failed" });
            }
          );
        } else if (req.ride_type !== undefined && req.ride_type !== null) {
          //Batch request - history request
          new Promise((res0) => {
            getBachRidesHistory(
              req,
              collectionRidesDeliveryData,
              collectionDrivers_profiles,
              res0
            );
          }).then(
            (result) => {
              logger.info(result);
              res.send(result);
            },
            (error) => {
              logger.info(error);
              res.send({ response: "error_authentication_failed" });
            }
          );
        } //Invalid data
        else {
          res.send({ response: "error_authentication_failed" });
        }
      } //Invalid data
      else {
        res.send({ response: "error_authentication_failed" });
      }
    });

    /**
     * COMPUTE DAILY REQUESTS AMMOUNT FOR DRIVERS
     * Responsible for getting the daily amount made so far by the driver for exactly all the completed requests.
     */
    app.get("/computeDaily_amountMadeSoFar", function (req, res) {
      new Promise((resMAIN) => {
        resolveDate();
        let params = urlParser.parse(req.url, true);
        req = params.query;

        if (
          req.driver_fingerprint !== undefined &&
          req.driver_fingerprint !== null
        ) {
          new Promise((res0) => {
            getDaily_requestAmount_driver(
              collectionRidesDeliveryData,
              collectionDrivers_profiles,
              req.driver_fingerprint,
              req.avoidCached_data !== undefined &&
                req.avoidCached_data !== null
                ? true
                : false,
              res0
            );
          }).then(
            (result) => {
              resMAIN(result);
            },
            (error) => {
              logger.info(error);
              resMAIN({
                amount: 0,
                currency: "NAD",
                currency_symbol: "N$",
                supported_requests_types: "none",
                response: "error",
              });
            }
          );
        } //Error
        else {
          resMAIN({
            amount: 0,
            currency: "NAD",
            currency_symbol: "N$",
            supported_requests_types: "none",
            response: "error",
          });
        }
      })
        .then(
          (result) => {
            res.send(result);
          },
          (error) => {
            logger.info(error);
            res.send({
              amount: 0,
              currency: "NAD",
              currency_symbol: "N$",
              supported_requests_types: "none",
              response: "error",
            });
          }
        )
        .catch((error) => {
          logger.info(error);
          res.send({
            amount: 0,
            currency: "NAD",
            currency_symbol: "N$",
            supported_requests_types: "none",
            response: "error",
          });
        });
    });

    /**
     * Go ONLINE/OFFLINE FOR DRIVERS
     * Responsible for going online or offline for drivers / or getting the operational status of drivers (online/offline).
     * ! Use Caching
     * @param driver_fingerprint
     * @param state: online or offline
     */
    app.get("/goOnline_offlineDrivers", function (req, res) {
      new Promise((resMAIN) => {
        resolveDate();
        let params = urlParser.parse(req.url, true);
        req = params.query;
        let redisKey = "offline_online_status-" + req.driver_fingerprint;

        if (
          req.driver_fingerprint !== undefined &&
          req.driver_fingerprint !== null &&
          req.action !== undefined &&
          req.action !== null &&
          req.state !== undefined &&
          req.state !== null
        ) {
          if (/make/i.test(req.action)) {
            //Found a driver
            let updateData = {
              $set: {
                "operational_state.status": /online/i.test(req.state)
                  ? "online"
                  : "offline",
              },
            };
            //Make a modification
            //Valid data received
            new Promise((res0) => {
              //Check the driver
              collectionDrivers_profiles
                .find({ driver_fingerprint: req.driver_fingerprint })
                .toArray(function (err, driverData) {
                  if (err) {
                    res0({ response: "error_invalid_request" });
                  }
                  //...
                  if (driverData.length > 0) {
                    //! GET THE SUSPENSION INFOS
                    let suspensionInfos = {
                      is_suspended:
                        driverData[0].isDriverSuspended !== undefined &&
                        driverData[0].isDriverSuspended !== null
                          ? driverData[0].isDriverSuspended
                          : false,
                      message:
                        driverData[0].suspension_infos !== undefined &&
                        driverData[0].suspension_infos !== null
                          ? /UNPAID_COMISSION/i.test(
                              driverData[0].suspension_infos[
                                driverData[0].suspension_infos.length - 1
                              ].reason
                            )
                            ? `Your account has been suspended to an overdue TaxiConnect commission.`
                            : false
                          : false,
                    };
                    //! ------------------------
                    //Check if the driver has an active request - NOT LOG OUT WITH AN ACTIVE REQUEST
                    let checkActiveRequests = {
                      taxi_id: req.driver_fingerprint,
                      "ride_state_vars.isAccepted": true,
                      "ride_state_vars.isRideCompleted_driverSide": false,
                    };
                    //check
                    collectionRidesDeliveryData
                      .find(checkActiveRequests)
                      .toArray(function (err, currentActiveRequests) {
                        if (err) {
                          res0({ response: "error_invalid_request" });
                        }
                        //...
                        if (/offline/i.test(req.state)) {
                          //Only if the driver wants to go out
                          if (currentActiveRequests.length <= 0) {
                            //No active requests - proceed
                            collectionDrivers_profiles.updateOne(
                              { driver_fingerprint: req.driver_fingerprint },
                              updateData,
                              function (err, reslt) {
                                if (err) {
                                  res0({ response: "error_invalid_request" });
                                }
                                //...
                                //Save the going offline event
                                new Promise((res) => {
                                  collectionGlobalEvents.insertOne({
                                    event_name:
                                      "driver_switching_status_request",
                                    status: /online/i.test(req.state)
                                      ? "online"
                                      : "offline",
                                    driver_fingerprint: req.driver_fingerprint,
                                    date: new Date(chaineDateUTC),
                                  });
                                  res(true);
                                }).then(
                                  () => {},
                                  () => {}
                                );
                                //? Update the cache
                                new Promise((resGetStatus) => {
                                  getDriver_onlineOffline_status(
                                    req,
                                    resGetStatus
                                  );
                                })
                                  .then(
                                    (result) => {
                                      //!Cache the result
                                      redisCluster.setex(
                                        redisKey,
                                        parseInt(
                                          process.env.REDIS_EXPIRATION_5MIN
                                        ) * 9,
                                        JSON.stringify(result)
                                      );
                                    },
                                    (error) => {}
                                  )
                                  .catch();
                                //Done
                                res0({
                                  response: "successfully_done",
                                  flag: /online/i.test(req.state)
                                    ? "online"
                                    : "offline",
                                  suspension_infos: suspensionInfos,
                                });
                              }
                            );
                          } //Has an active request - abort going offline
                          else {
                            res0({
                              response:
                                "error_going_offline_activeRequest_inProgress",
                            });
                          }
                        } //If the driver want to go online - proceed
                        else {
                          collectionDrivers_profiles.updateOne(
                            { driver_fingerprint: req.driver_fingerprint },
                            updateData,
                            function (err, reslt) {
                              if (err) {
                                res0({ response: "error_invalid_request" });
                              }
                              //...
                              //Save the going offline event
                              new Promise((res) => {
                                collectionGlobalEvents.insertOne({
                                  event_name: "driver_switching_status_request",
                                  status: /online/i.test(req.state)
                                    ? "online"
                                    : "offline",
                                  driver_fingerprint: req.driver_fingerprint,
                                  date: new Date(chaineDateUTC),
                                });
                                res(true);
                              }).then(
                                () => {},
                                () => {}
                              );
                              //? Update the cache
                              new Promise((resGetStatus) => {
                                getDriver_onlineOffline_status(
                                  req,
                                  resGetStatus
                                );
                              })
                                .then(
                                  (result) => {
                                    //!Cache the result
                                    redisCluster.setex(
                                      redisKey,
                                      parseInt(
                                        process.env.REDIS_EXPIRATION_5MIN
                                      ) * 9,
                                      JSON.stringify(result)
                                    );
                                  },
                                  (error) => {}
                                )
                                .catch();
                              //Done
                              res0({
                                response: "successfully_done",
                                flag: /online/i.test(req.state)
                                  ? "online"
                                  : "offline",
                                suspension_infos: suspensionInfos,
                              });
                            }
                          );
                        }
                      });
                  } //Error - unknown driver
                  else {
                    res0({ response: "error_invalid_request" });
                  }
                });
            }).then(
              (result) => {
                resMAIN(result);
              },
              (error) => {
                logger.info(error);
                resMAIN({ response: "error_invalid_request" });
              }
            );
          } else if (/get/i.test(req.action)) {
            /*resMAIN({
              response: "successfully_got",
              flag: "online",
              //suspension_infos: { is_suspended: false },
            });*/
            //Check the cache first
            redisGet(redisKey).then(
              (resp) => {
                if (resp !== null) {
                  try {
                    new Promise((resGetStatus) => {
                      getDriver_onlineOffline_status(req, resGetStatus);
                    })
                      .then(
                        (result) => {
                          //!Cache the result
                          redisCluster.setex(
                            redisKey,
                            parseInt(process.env.REDIS_EXPIRATION_5MIN) * 9,
                            JSON.stringify(result)
                          );
                        },
                        (error) => {
                          logger.info(error);
                        }
                      )
                      .catch((error) => {
                        logger.info(error);
                      });
                    //Quickly return result
                    logger.info(resp);
                    resMAIN(JSON.parse(resp));
                  } catch (error) {
                    new Promise((resGetStatus) => {
                      getDriver_onlineOffline_status(req, resGetStatus);
                    })
                      .then(
                        (result) => {
                          //!Cache the result
                          redisCluster.setex(
                            redisKey,
                            parseInt(process.env.REDIS_EXPIRATION_5MIN) * 9,
                            JSON.stringify(result)
                          );
                          //...
                          resMAIN(result);
                        },
                        (error) => {
                          logger.info(error);
                          resMAIN({ response: "error_invalid_request" });
                        }
                      )
                      .catch((error) => {
                        logger.info(error);
                        resMAIN({ response: "error_invalid_request" });
                      });
                  }
                } //Make a fresh request
                else {
                  new Promise((resGetStatus) => {
                    getDriver_onlineOffline_status(req, resGetStatus);
                  })
                    .then(
                      (result) => {
                        //!Cache the result
                        redisCluster.setex(
                          redisKey,
                          parseInt(process.env.REDIS_EXPIRATION_5MIN) * 9,
                          JSON.stringify(result)
                        );
                        //...
                        resMAIN(result);
                      },
                      (error) => {
                        logger.info(error);
                        resMAIN({ response: "error_invalid_request" });
                      }
                    )
                    .catch((error) => {
                      logger.info(error);
                      resMAIN({ response: "error_invalid_request" });
                    });
                }
              },
              (error) => {
                //Make a fresh request
                logger.info(error);
                new Promise((resGetStatus) => {
                  getDriver_onlineOffline_status(req, resGetStatus);
                })
                  .then(
                    (result) => {
                      //!Cache the result
                      redisCluster.setex(
                        redisKey,
                        parseInt(process.env.REDIS_EXPIRATION_5MIN) * 9,
                        JSON.stringify(result)
                      );
                      //...
                      resMAIN(result);
                    },
                    (error) => {
                      logger.info(error);
                      resMAIN({ response: "error_invalid_request" });
                    }
                  )
                  .catch((error) => {
                    logger.info(error);
                    resMAIN({ response: "error_invalid_request" });
                  });
              }
            );
          }
        } //Invalid data
        else {
          resMAIN({
            response: "successfully_got",
            flag: "online",
            suspension_infos: { is_suspended: false },
          });
          //resMAIN({ response: "error_invalid_request" });
        }
      })
        .then((result) => {
          res.send(result);
        })
        .catch((error) => {
          logger.info(error);
          //res.send({ response: "error_invalid_request" });
          res.send({
            response: "successfully_got",
            flag: "online",
            suspension_infos: { is_suspended: false },
          });
        });
    });

    /**
     * COMPUTE WALLET SUMMARY FOR RIDERS
     * ? Responsible for computing the wallet summary (total and detailed) for the riders.
     * ! Supports 2 modes: total (will only return the current total wallet balance) or detailed (will return the total amount and the list of all wallet transactions)
     */
    app.get("/getRiders_walletInfos", function (req, res) {
      resolveDate();
      let params = urlParser.parse(req.url, true);
      req = params.query;
      logger.info(req);

      if (
        req.user_fingerprint !== undefined &&
        req.user_fingerprint !== null &&
        req.mode !== undefined &&
        req.mode !== null
      ) {
        let regModeLimiter = new RegExp(req.mode, "i"); //Limit data to total balance (total) or total balance+details (detailed)
        new Promise((resolve) => {
          getRiders_wallet_summary(
            req,
            collectionRidesDeliveryData,
            collectionWalletTransactions_logs,
            collectionDrivers_profiles,
            collectionPassengers_profiles,
            resolve,
            req.avoidCached_data !== undefined && req.avoidCached_data !== null
              ? true
              : false,
            req.userType !== undefined && req.userType !== null
              ? req.userType
              : "rider"
          );
        }).then(
          (result) => {
            try {
              //! ADD EXCEPTIONS
              let exceptions_users_to_wallet = [
                "5b29bb1b9ac69d884f13fd4be2badcd22b72b98a69189bfab806dcf7c5f5541b6cbe8087cf60c791",
                "48aecfa6a98979574c6db8a77fd0a9e09dd4f37b2e4811343c65d31a88c404f46169466ff0e03e46",
              ];
              result.wallet_state = exceptions_users_to_wallet.includes(
                req.user_fingerprint
              )
                ? "unlocked"
                : process.env.USERS_WALLET_STATE;
              //...
              let responseHolder = regModeLimiter.test("detailed")
                ? result
                : result.total !== undefined
                ? {
                    total: result.total,
                    wallet_state: process.env.USERS_WALLET_STATE,
                  }
                : { total: 0, wallet_state: process.env.USERS_WALLET_STATE };
              if (
                /"transactions\_data"\:"0"/i.test(stringify(responseHolder))
              ) {
                //! No records - send predefined - Major bug fix!
                res.send(
                  regModeLimiter.test("detailed")
                    ? {
                        total: 0,
                        transactions_data: null,
                        wallet_state: process.env.USERS_WALLET_STATE,
                      }
                    : { total: 0, wallet_state: process.env.USERS_WALLET_STATE }
                );
              } //Has some records
              else {
                res.send(
                  regModeLimiter.test("detailed")
                    ? result
                    : result.total !== undefined
                    ? {
                        total: result.total,
                        wallet_state: process.env.USERS_WALLET_STATE,
                      }
                    : { total: 0, wallet_state: process.env.USERS_WALLET_STATE }
                );
              }
            } catch (error) {
              logger.info(error);
              res.send(
                regModeLimiter.test("detailed")
                  ? {
                      total: 0,
                      transactions_data: null,
                      wallet_state: process.env.USERS_WALLET_STATE,
                    }
                  : { total: 0, wallet_state: process.env.USERS_WALLET_STATE }
              );
            }
          },
          (error) => {
            logger.info(error);
            res.send(
              regModeLimiter.test("detailed")
                ? {
                    total: 0,
                    transactions_data: null,
                    wallet_state: process.env.USERS_WALLET_STATE,
                  }
                : { total: 0, wallet_state: process.env.USERS_WALLET_STATE }
            );
          }
        );
      } //Invalid parameters
      else {
        let regModeLimiter = new RegExp(req.mode, "i"); //Limit data to total balance (total) or total balance+details (detailed)
        res.send(
          regModeLimiter.test("detailed")
            ? {
                total: 0,
                transactions_data: null,
                response: "error",
                tag: "invalid_parameters",
                wallet_state: process.env.USERS_WALLET_STATE,
              }
            : {
                total: 0,
                response: "error",
                tag: "invalid_parameters",
                wallet_state: process.env.USERS_WALLET_STATE,
              }
        );
      }
    });

    /**
     * COMPUTE THE DETAILED WALLET SUMMARY FOR THE DRIVERS
     * ? Responsible for computing the wallet summary (total and detailed) for the drivers.
     */
    app.get("/getDrivers_walletInfosDeep", function (req, res) {
      new Promise((resMAIN) => {
        resolveDate();
        let params = urlParser.parse(req.url, true);
        req = params.query;
        logger.info(req);

        if (
          req.user_fingerprint !== undefined &&
          req.user_fingerprint !== null
        ) {
          let regModeLimiter = new RegExp(req.mode, "i"); //Limit data to total balance (total) or total balance+details (detailed)

          new Promise((resCompute) => {
            let url =
              process.env.LOCAL_URL +
              ":" +
              process.env.ACCOUNTS_SERVICE_PORT +
              "/getRiders_walletInfos?user_fingerprint=" +
              req.user_fingerprint +
              "&mode=detailed&userType=driver";

            //Add caching strategy if any
            if (req.avoidCached_data !== undefined) {
              url += "&avoidCached_data=" + req.avoidCached_data;
            }

            requestAPI(url, function (error, response, body) {
              if (error === null) {
                try {
                  body = JSON.parse(body);
                  if (
                    body.transactions_data !== null &&
                    body.transactions_data !== undefined &&
                    body.transactions_data.length > 0
                  ) {
                    //? Has some transaction data
                    resCompute(body);
                  } //! No transaction data - return current value
                  else {
                    resCompute(
                      regModeLimiter.test("detailed")
                        ? {
                            total: 0,
                            transactions_data: null,
                            response: "empty",
                            tag: "empty_wallet",
                          }
                        : { total: 0, response: "empty", tag: "empty_wallet" }
                    );
                  }
                } catch (error) {
                  resCompute(
                    regModeLimiter.test("detailed")
                      ? {
                          total: 0,
                          transactions_data: null,
                          response: "error",
                          tag: "invalid_parameters",
                        }
                      : {
                          total: 0,
                          response: "error",
                          tag: "invalid_parameters",
                        }
                  );
                }
              } else {
                resCompute(
                  regModeLimiter.test("detailed")
                    ? {
                        total: 0,
                        transactions_data: null,
                        response: "error",
                        tag: "invalid_parameters",
                      }
                    : { total: 0, response: "error", tag: "invalid_parameters" }
                );
              }
            });
          })
            .then(
              (resultWalletdata) => {
                //? Final data
                new Promise((resGetDeepInsights) => {
                  let redisKey = `${req.user_fingerprint}-deepWalletData-driver`;
                  //?computeDriver_walletDeepInsights(walletBasicData, redisKey, avoidCached_data?, resolve)
                  computeDriver_walletDeepInsights(
                    resultWalletdata,
                    collectionWalletTransactions_logs,
                    req.user_fingerprint,
                    redisKey,
                    req.avoidCached_data !== undefined &&
                      req.avoidCached_data !== null
                      ? req.avoidCached_data
                      : false,
                    resGetDeepInsights
                  );
                })
                  .then(
                    (resultInsights) => {
                      //! Sort the weeks from the biggest week and year to the smallest
                      resultInsights.weeks_view =
                        resultInsights.weeks_view !== null &&
                        resultInsights.weeks_view !== undefined
                          ? resultInsights.weeks_view.sort((a, b) =>
                              a.year_number < b.year_number &&
                              a.week_number < b.year_number
                                ? -1
                                : 1
                            )
                          : resultInsights.weeks_view;
                      //? Remove the record holder
                      //? Add transaction data if transactionData=true
                      res.send(
                        resultInsights.header !== undefined &&
                          resultInsights.header !== null
                          ? req.transactionData !== undefined &&
                            /true/i.test(req.transactionData)
                            ? {
                                header: resultInsights.header,
                                weeks_view: resultInsights.weeks_view,
                                transactions_data:
                                  resultInsights.transactions_data,
                              }
                            : {
                                header: resultInsights.header,
                                weeks_view: resultInsights.weeks_view,
                              }
                          : resultInsights
                      );
                    },
                    (error) => {
                      logger.info(error);
                      res.send({
                        header: null,
                        weeks_view: null,
                        response: "error",
                      });
                    }
                  )
                  .catch((error) => {
                    logger.info(error);
                    res.send({
                      header: null,
                      weeks_view: null,
                      response: "error",
                    });
                  });
              },
              (error) => {
                logger.info(error);
                res.send({
                  header: null,
                  weeks_view: null,
                  response: "error",
                });
              }
            )
            .catch((error) => {
              logger.info(error);
              res.send({
                header: null,
                weeks_view: null,
                response: "error",
              });
            });
        } //Invalid params
        else {
          res.send({
            header: null,
            weeks_view: null,
            response: "error",
          });
        }
        //...
        resMAIN(true);
      })
        .then()
        .catch();
    });

    /**
     * MODIFY PASSENGERS PROFILE DETAILS
     * ? Responsible for updating ANY information related to the passengers profile.
     * ? Informations that can be updated: name, surname, picture, email, phone number, gender.
     */
    app.post("/updateRiders_profileInfos", function (req, res) {
      resolveDate();
      req = req.body;

      if (
        req.user_fingerprint !== undefined &&
        req.user_fingerprint !== null &&
        req.infoToUpdate !== undefined &&
        req.infoToUpdate !== null &&
        req.dataToUpdate !== undefined &&
        req.dataToUpdate !== null
      ) {
        new Promise((resolve) => {
          updateRiders_generalProfileInfos(
            collectionPassengers_profiles,
            collection_OTP_dispatch_map,
            collectionGlobalEvents,
            req,
            resolve
          );
        }).then(
          (result) => {
            res.send(result);
          },
          (error) => {
            res.send({ response: "error", flag: "invalid_data" });
          }
        );
      } //Invalid data
      else {
        res.send({ response: "error", flag: "invalid_data" });
      }
    });

    /**
     * GATHER ADS ANALYTICS FOR RIDERS
     * ? Responsible for ccollecting all the Ads events from the riders/drivers app.
     * ? Information: user fingerprint, user nature (rider, driver), screen identifier, company identifier, campaign identifier
     */
    app.post("/gatherAdsManagerAnalytics", function (req, res) {
      resolveDate();
      req = req.body;
      //logger.warn(req);
      res.send({ response: "error", flag: "no_ads_to_get" });

      /*if (
      req.user_fingerprint !== undefined &&
      req.user_fingerprint !== null &&
      req.user_nature !== undefined &&
      req.user_nature !== null &&
      req.screen_identifier !== undefined &&
      req.screen_identifier !== null &&
      req.company_identifier !== undefined &&
      req.company_identifier !== null &&
      req.campaign_identifier !== undefined &&
      req.campaign_identifier !== null
    ) {
      new Promise((resolve) => {
        try {
          //! Save the Ad event
          let eventBundle = {
            event_name: "Ad_gathering",
            user_fingerprint: req.user_fingerprint,
            user_nature: req.user_nature,
            ad_infos: {
              screen_identifier: req.screen_identifier,
              company_identifier: req.company_identifier,
              campaign_identifier: req.campaign_identifier,
            },
            date: new Date(chaineDateUTC),
          };
          //! -----
          collectionGlobalEvents.insertOne(eventBundle, function (err, result) {
            if (err) {
              logger.warn(err);
            }
            //...
            resolve(true);
          });
        } catch (error) {
          logger.warn(error);
          resolve(false);
        }
      })
        .then(
          (result) => {
            logger.info(result);
            res.send({ response: "success" });
          },
          (error) => {
            logger.info(error);
            res.send({ response: "error", flag: "invalid_data" });
          }
        )
        .catch((error) => {
          logger.info(error);
          res.send({ response: "error", flag: "invalid_data" });
        });
    } //Invalid data
    else {
      res.send({ response: "error", flag: "invalid_data" });
    }*/
    });

    /**
     * GET AD INFORMATION
     * ? Responsible for getting the ad infos for the companies based on the operating city to the riders/drivers
     * ? Required infos: user_fingerprint.
     * ! Cache as much as possible.
     */
    app.get("/getAdsManagerRunningInfos", function (req, res) {
      resolveDate();
      let params = urlParser.parse(req.url, true);
      req = params.query;
      res.send({ response: "error", flag: "invalid_data" });
      /*logger.info(req);

    if (
      req.user_fingerprint !== undefined &&
      req.user_fingerprint !== null &&
      req.user_nature !== undefined &&
      req.user_nature !== null &&
      req.city !== undefined &&
      req.city !== null
    ) {
      //Valid
      //? Get the only visible Ad campaign based on the operation city
      new Promise((resGet) => {
        getAdsManagerRunningInfos(req, resGet);
      })
        .then(
          (result) => {
            res.send(result);
          },
          (error) => {
            logger.info(error);
            res.send({ response: "error", flag: "invalid_data" });
          }
        )
        .catch((error) => {
          logger.info(error);
          res.send({ response: "error", flag: "invalid_data" });
        });
    } //Invalid data
    else {
      res.send({ response: "error", flag: "invalid_data" });
    }*/
    });

    /**
     * DRIVERS REFERRAL API
     * ? Responsible for performing all the referral related information: checking drivers, submitting referrals,
     * ? getting the list of referred drivers by a specific user.
     * ! Cache as much as possible.
     * @param user_fingerprint
     * @param user_nature: rider/driver
     * @param action: get, submit or check
     * @param driver_infos: name, taxi_number and phone_number of the driver being referred.
     */
    app.get("/performDriversReferralOperations", function (req, res) {
      resolveDate();
      let params = urlParser.parse(req.url, true);
      req = params.query;

      if (
        req.user_fingerprint !== undefined &&
        req.user_fingerprint !== null &&
        req.user_nature !== undefined &&
        req.user_nature !== null &&
        /(rider|driver)/i.test(req.user_nature) &&
        req.action !== undefined &&
        req.action !== null
      ) {
        if (/get/i.test(req.action)) {
          //Get the list of referred drivers
          //? Save the get event
          new Promise((resEvent) => {
            let eventSaverObj = {
              event_name: "getting_referral_forTaxiDriver_userList",
              user_referrer: req.user_fingerprint,
              user_referrer_nature: req.user_nature,
              date: new Date(chaineDateUTC),
            };
            //...
            collectionGlobalEvents.insertOne(
              eventSaverObj,
              function (err, reslt) {
                resEvent(true);
              }
            );
          });
          //? --------------------
          let redisKey = `${req.user_fingerprint}-referredDriversList-CACHE`;
          redisGet(redisKey)
            .then((resp) => {
              if (resp !== null) {
                //REHYDRATE
                new Promise((resCompute) => {
                  getReferredDrivers_list(
                    req,
                    collectionReferralsInfos,
                    redisKey,
                    resCompute
                  );
                })
                  .then()
                  .catch();
                //...
                res.send(JSON.parse(resp));
              } //No records found - do a fresh request
              else {
                new Promise((resCompute) => {
                  getReferredDrivers_list(
                    req,
                    collectionReferralsInfos,
                    redisKey,
                    resCompute
                  );
                })
                  .then((result) => {
                    res.send(result);
                  })
                  .catch((error) => {
                    logger.info(error);
                    res.send({ response: "error_unexpected" });
                  });
              }
            })
            .catch((error) => {
              new Promise((resCompute) => {
                getReferredDrivers_list(
                  req,
                  collectionReferralsInfos,
                  redisKey,
                  resCompute
                );
              })
                .then((result) => {
                  res.send(result);
                })
                .catch((error) => {
                  logger.info(error);
                  res.send({ response: "error_unexpected" });
                });
            });
        } else if (
          /check/i.test(req.action) &&
          req.taxi_number !== undefined &&
          req.taxi_number !== null
        ) {
          //Check the driver's taxi number
          //? Save the checking event
          new Promise((resEvent) => {
            let eventSaverObj = {
              event_name: "checking_referral_forTaxiDriver",
              user_referrer: req.user_fingerprint,
              user_referrer_nature: req.user_nature,
              taxi_number: req.taxi_number,
              date: new Date(chaineDateUTC),
            };
            //...
            collectionGlobalEvents.insertOne(
              eventSaverObj,
              function (err, reslt) {
                resEvent(true);
              }
            );
          });
          //? --------------------
          //! Check that the user is authentic
          let collectionToCheck = /rider/i.test(req.user_nature)
            ? collectionPassengers_profiles
            : collectionDrivers_profiles;
          let finderUserQuery = /rider/i.test(req.user_nature)
            ? { user_fingerprint: req.user_fingerprint }
            : { driver_fingerprint: req.user_fingerprint };

          collectionToCheck
            .find(finderUserQuery)
            .toArray(function (err, userData) {
              if (err) {
                res.send({ response: "error_unexpected_auth" });
              }
              //...
              if (userData !== undefined && userData.length > 0) {
                //? Authentic user
                //! Format the driver's taxi number
                req.taxi_number = req.taxi_number.toUpperCase().trim();
                //!---
                new Promise((resCompute) => {
                  //1. Check if the driver is already registered
                  let finderQuery = {
                    "cars_data.taxi_number": req.taxi_number,
                  };
                  collectionDrivers_profiles
                    .find(finderQuery)
                    .collation({ locale: "en", strength: 2 })
                    .toArray(function (err, reslt) {
                      if (err) {
                        resCompute({ response: "error_unexpected" });
                      }
                      //...
                      if (reslt !== undefined && reslt.length > 0) {
                        //Driver already registered
                        resCompute({ response: "driver_alreadyRegistered" });
                      } //Driver not yet officially registered
                      else {
                        //? 2. Check if the driver was already referred
                        let finderNarrower = {
                          taxi_number: req.taxi_number,
                          is_referralExpired: false,
                        };
                        //...
                        collectionReferralsInfos
                          .find(finderNarrower)
                          .collation({ locale: "en", strength: 2 })
                          .toArray(function (err, result) {
                            if (err) {
                              resCompute({ response: "error_unexpected" });
                            }
                            //...
                            if (result !== undefined && result.length > 0) {
                              //! Driver already referred
                              resCompute({
                                response: "driver_alreadyReferred",
                              });
                            } //? Not yet referred
                            else {
                              resCompute({
                                response: "driver_freeForReferral",
                              });
                            }
                          });
                      }
                    });
                })
                  .then((result) => {
                    res.send(result);
                  })
                  .catch((error) => {
                    logger.info(error);
                    res.send({ response: "error_unexpected" });
                  });
              } //Fraud user
              else {
                res.send({ response: "error_unexpected_auth" });
              }
            });
        } else if (
          /submit/i.test(req.action) &&
          req.taxi_number !== undefined &&
          req.taxi_number !== null &&
          req.driver_phone !== undefined &&
          req.driver_phone !== null &&
          req.driver_name !== undefined &&
          req.driver_name !== null
        ) {
          //Submit the user's (rider/driver) referral request
          //! Format the infos
          req.taxi_number = req.taxi_number.toUpperCase().trim();
          req.driver_phone = req.driver_phone.trim();
          new Promise((resCompute) => {
            //! 1. Check for non duplicata
            let finderNarrower = {
              taxi_number: req.taxi_number,
              user_referrer: req.user_fingerprint,
              user_referrer_nature: req.user_nature,
              is_referralExpired: false,
            };
            //...
            collectionReferralsInfos
              .find(finderNarrower)
              .collation({ locale: "en", strength: 2 })
              .toArray(function (err, result) {
                if (err) {
                  resCompute({ response: "error_unexpected" });
                }
                //...
                if (result !== undefined && result.length > 0) {
                  //! Found an active referral
                  resCompute({
                    response: "error_unexpected_foundActive",
                  });
                } //? Not yet referred
                else {
                  //ADD 2 DAYS MAX OF EXPIRATION TIME.
                  let referralObject = {
                    referral_fingerprint: dateObject.unix(),
                    driver_name: req.driver_name,
                    driver_phone: req.driver_phone,
                    taxi_number: req.taxi_number,
                    user_referrer: req.user_fingerprint,
                    user_referrer_nature: req.user_nature,
                    expiration_time: new Date(
                      new Date(chaineDateUTC).getTime() + 2 * 24 * 3600 * 1000
                    ),
                    is_referralExpired: false,
                    is_paid: false,
                    amount_paid: false,
                    amount_paid_percentage: 50,
                    is_referral_rejected: false, //! Whether the referral is rejected or not: Rejected referrals cannot receive payments.
                    is_official_deleted_user_side: false, //! Deleted referrals on the user side cannot receive payment or be seen ever again by the user, only not paid referrals can be deleted.
                    date_referred: new Date(chaineDateUTC),
                  };
                  new Promise((res) => {
                    generateUniqueFingerprint(
                      `${chaineDateUTC}-${req.user_fingerprint}-${req.driver_phone}`,
                      false,
                      res
                    );
                  })
                    .then(
                      (result) => {
                        referralObject.referral_fingerprint = result; //Update with the fingerprint;
                      },
                      (error) => {
                        logger.warn(error);
                        referralObject.referral_fingerprint =
                          parsedData.user_fingerprint + dateObject.unix(); //Make a fingerprint out of the timestamp
                      }
                    )
                    .finally(() => {
                      //...
                      collectionReferralsInfos.insertOne(
                        referralObject,
                        function (err, result) {
                          if (err) {
                            resCompute({ response: "error_unexpected" });
                          }
                          //...
                          resCompute({ response: "successfully_referred" });
                        }
                      );
                    });
                }
              });
          })
            .then((result) => {
              res.send(result);
            })
            .catch((error) => {
              logger.warn(error);
              resCompute({ response: "error_unexpected" });
            });
        } //Invalid data received
        else {
          res.send({ response: "error_invalid_data" });
        }
      } //Invalid data received
      else {
        res.send({ response: "error_invalid_data" });
      }
    });
  });
});

server.listen(process.env.ACCOUNTS_SERVICE_PORT);
//dash.monitor({ server: server });
