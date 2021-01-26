require("dotenv").config();
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
const requestAPI = require("request");
const crypto = require("crypto");
const escapeStringRegexp = require("escape-string-regexp");
//....
const { promisify, inspect } = require("util");
const urlParser = require("url");
const redis = require("redis");
const client = redis.createClient({
  host: process.env.REDIS_HOST,
  port: process.env.REDIS_PORT,
});
const redisGet = promisify(client.get).bind(client);

var isBase64 = require("is-base64");
var chaineDateUTC = null;
var dateObject = null;
const moment = require("moment");
var otpGenerator = require("otp-generator");
const { resolve } = require("path");

const clientMongo = new MongoClient(process.env.URL_MONGODB, {
  useUnifiedTopology: true,
});

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
        });
      } //Not yet registeredd
      else {
        resolve({ response: "not_yet_registered" });
      }
    });
}

/**
 * @func getBachRidesHistory
 * @param collectionRidesDeliveryData: list of all rides made
 * @param collectionDrivers_profiles: list of all drivers
 * @param resolve
 * @param req: the requests arguments : user_fp, ride_type, and/or the targeted argument
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
        res0({
          "ride_state_vars.isRideCompleted_riderSide": true,
        });
      } else if (/scheduled/i.test(req.ride_type)) {
        //Scheduled
        res0({
          request_type: { $regex: /^scheduled$/, $options: "i" },
        });
      } else if (/business/i.test(req.ride_type)) {
        //Business
        res0({
          ride_flag: { $regex: /business/, $options: "i" },
        });
      } //Invalid data
      else {
        res0(false);
      }
    } //Targeted request
    else {
      console.log("Targeted request detected!");
      res0({
        request_fp: req.request_fp,
      });
    }
  }).then(
    (result) => {
      if (result !== false) {
        //Got some object
        //Get the mongodb data
        collectionRidesDeliveryData
          .find(result)
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
                  console.log(error);
                  resolve({ response: "error_authentication_failed" });
                }
              );
            } //Empty
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
      } //invalid data
      else {
        console.log("Invalid");
        resolve({ response: "error_authentication_failed" });
      }
    },
    (error) => {
      console.log(error);
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
  console.log("is targeted -> ", shrink_for_targeted);
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
        console.log(result);
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
          res(false);
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
        console.log(error);
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
            console.log("cached result found");
            resolve(resp);
          } catch (error) {
            //Erro - make a fresh request
            console.log(error);
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
                console.log(error);
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
              console.log(error);
              resolve(false);
            }
          );
        }
      },
      (error) => {
        //Error - make a fresh request
        console.log(error);
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
            console.log(error);
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
              console.log(car);
              car_brand = car.car_brand;
              car_picture = car.taxi_picture;
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
              driver_picture = driver.identification_data.profile_picture;
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
        full_request_schema.payment_method = request.payment_method.toUpperCase();
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
                client.set(
                  redisKey,
                  JSON.stringify(full_request_schema),
                  redis.print
                );
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
      console.log(error);
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
 * @param resolve
 */
function getDaily_requestAmount_driver(
  collectionRidesDeliveryData,
  collectionDrivers_profiles,
  driver_fingerprint,
  resolve
) {
  resolveDate();
  //Form the redis key
  let redisKey = "dailyAmount-" + driver_fingerprint;
  //..
  redisGet(redisKey).then(
    (resp) => {
      if (resp !== null) {
        //Has a previous record
        try {
          resp = JSON.parse(resp);
          //Rehydrate the cached results
          new Promise((res) => {
            exec_computeDaily_amountMade(
              collectionRidesDeliveryData,
              collectionDrivers_profiles,
              driver_fingerprint,
              res
            );
          }).then(
            (result) => {
              //Cache as well
              client.set(redisKey, JSON.stringify(result));
            },
            (error) => {
              console.log(error);
            }
          );
          //...
          resolve(resp);
        } catch (error) {
          console.log(error);
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
              console.log(result);
              //Cache as well
              client.set(redisKey, JSON.stringify(result));
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
            console.log(result);
            //Cache as well
            client.set(redisKey, JSON.stringify(result));
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
      console.log(error);
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
          console.log(result);
          //Cache as well
          client.set(redisKey, JSON.stringify(result));
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
      driverProfile = driverProfile[0];
      //...
      let filterRequest = {
        taxi_id: driver_fingerprint,
        "ride_state_vars.isRideCompleted_driverSide": true,
        "ride_state_vars.isRideCompleted_riderSide": true,
        date_requested: {
          $regex: escapeStringRegexp(chaineDateUTC.split(" ")[0]),
          $options: "i",
        },
      };

      collectionRidesDeliveryData
        .find(filterRequest)
        .toArray(function (err, requestsArray) {
          if (err) {
            resolve({
              amount: 0,
              currency: "NAD",
              currency_symbol: "N$",
              supported_requests_types: driverProfile.operation_clearances.join(
                "-"
              ),
              response: "error",
            });
          }
          //...
          let amount = 0;
          requestsArray.map((request) => {
            let tmpFare = parseFloat(request.fare);
            amount += tmpFare;
          });
          resolve({
            amount: amount,
            currency: "NAD",
            currency_symbol: "N$",
            supported_requests_types: driverProfile.operation_clearances.join(
              "-"
            ),
            response: "success",
          });
        });
    });
}

/**
 * @func getRiders_wallet_summary
 * Responsible for getting riders wallet informations.
 * @param requestObj: contains the user_fingerprint and the mode: total or detailed.
 * @param collectionRidesDeliveryData: the collection of all the requests.
 * @param collectionWalletTransactions_logs: the collection of all the possible wallet transactions.
 * @param collectionDrivers_profiles: collection of all the drivers
 * @param resolve
 * Cache for 5 min only
 * Redis Key: user_fingerprint+wallet-summaryInfos
 */
function getRiders_wallet_summary(
  requestObj,
  collectionRidesDeliveryData,
  collectionWalletTransactions_logs,
  collectionDrivers_profiles,
  resolve
) {
  //Form the redis key
  let redisKey = requestObj.user_fingerprint + "wallet-summary";
  redisGet(redisKey).then(
    (resp) => {
      if (resp !== null) {
        console.log("found cached data");
        //Has a previous record - reply with it and rehydrate the data
        try {
          //Rehydrate the cache
          new Promise((res) => {
            execGet_riders_walletSummary(
              requestObj,
              collectionRidesDeliveryData,
              collectionWalletTransactions_logs,
              collectionDrivers_profiles,
              redisKey,
              res
            );
          }).then(
            () => {},
            () => {}
          );
          //...Immediatly reply
          resp = JSON.parse(resp);
          resolve(resp);
        } catch (error) {
          console.log(error);
          //Error - make a fresh request
          new Promise((res) => {
            execGet_riders_walletSummary(
              requestObj,
              collectionRidesDeliveryData,
              collectionWalletTransactions_logs,
              collectionDrivers_profiles,
              redisKey,
              res
            );
          }).then(
            (result) => {
              resolve(result);
            },
            (error) => {
              console.log(error);
              resolve({ total: 0, transactions_data: null });
            }
          );
        }
      } //No previous records
      else {
        console.log("No previous cached data");
        new Promise((res) => {
          execGet_riders_walletSummary(
            requestObj,
            collectionRidesDeliveryData,
            collectionWalletTransactions_logs,
            collectionDrivers_profiles,
            redisKey,
            res
          );
        }).then(
          (result) => {
            resolve(result);
          },
          (error) => {
            console.log(error);
            resolve({ total: 0, transactions_data: null });
          }
        );
      }
    },
    (error) => {
      console.log(error);
      //Error happened - make a fresh request
      new Promise((res) => {
        execGet_riders_walletSummary(
          requestObj,
          collectionRidesDeliveryData,
          collectionWalletTransactions_logs,
          collectionDrivers_profiles,
          redisKey,
          res
        );
      }).then(
        (result) => {
          resolve(result);
        },
        (error) => {
          console.log(error);
          resolve({ total: 0, transactions_data: null });
        }
      );
    }
  );
}

/**
 * @func execGet_riders_walletSummary
 * Responsible for executing the requests and gather the rider's wallet complete infos.
 * @param requestObj: contains the user_fingerprint and the mode: total or detailed.
 * @param collectionRidesDeliveryData: the collection of all the requests.
 * @param collectionWalletTransactions_logs: the collection of all the possible wallet transactions.
 * @param collectionDrivers_profiles: collection of all the drivers
 * @param resolve
 *
 * ? transaction_nature types: topup, paidDriver, sentToFriend.
 * ? The wallet payments for rides are stored in the rides/deliveries collection.
 */
function execGet_riders_walletSummary(
  requestObj,
  collectionRidesDeliveryData,
  collectionWalletTransactions_logs,
  collectionDrivers_profiles,
  redisKey,
  resolve
) {
  //Get the current amount and all the details.
  let detailsData = {
    topedupAmount: 0, //The amount of money toped up since the beginning.
    paid_totalAmount: 0, //The total amount paid in the platform for rides/deliveries
    transactions_data: null, //The topups transactions
  };
  //...
  //1. Get the total topups
  new Promise((res) => {
    let filterTopups = {
      user_fingerprint: requestObj.user_fingerprint,
      transaction_nature: {
        $regex: /(topup|paidDriver|sentToFriend)/,
        $options: "i",
      },
    };
    //...
    collectionWalletTransactions_logs
      .find(filterTopups)
      .toArray(function (err, resultTransactions) {
        if (err) {
          console.log(err);
          res({ total: 0, transactions_data: null });
        }
        //..
        if (resultTransactions.length > 0) {
          //Found some records
          //Save the transactions data
          detailsData.transactions_data = resultTransactions;
          //Find the sum of all the transactions (not including rides/deliveries)
          resultTransactions.map((transaction) => {
            detailsData.topedupAmount += parseFloat(transaction.amount);
          });
          //Find the sum of all the paid transactions (rides/deliveries) - for wallet only
          //? Happend the cash data to the transaction data as well.
          let filterPaidRequests = {
            client_id: requestObj.user_fingerprint,
            isArrivedToDestination: true,
          };
          //...Only consider the completed requests
          collectionRidesDeliveryData
            .find(filterPaidRequests)
            .toArray(function (err, resultPaidRequests) {
              if (err) {
                console.log(err);
                res({ total: 0, transactions_data: null });
              }
              //...
              if (resultPaidRequests.length > 0) {
                detailsData.transactions_data = new Array();
                //Found some records
                //Save the requests transaction data and find the sum of the paid transactions
                let completedDataPromise = resultPaidRequests.map(
                  (paidRequests) => {
                    return new Promise((partialResolver) => {
                      //Get driver infos : for Taxis - taxi number / for private cars - drivers name
                      collectionDrivers_profiles
                        .find({ driver_fingerprint: paidRequests.taxi_id })
                        .toArray(function (err, driverProfile) {
                          if (err) {
                            console.log(err);
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
                                  driverData.taxi_number = car.taxi_number;
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
                          if (/wallet/i.test(paidRequests.payment_method)) {
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
                            });
                          } //Cash - only save transaction data
                          else {
                            partialResolver({
                              amount: parseFloat(paidRequests.fare),
                              transaction_nature: paidRequests.ride_mode,
                              payment_method: paidRequests.payment_method,
                              driverData: driverData,
                              date_captured: dateRequest,
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
                    detailsData.transactions_data = finalData;
                    //Done
                    res({
                      total:
                        detailsData.topedupAmount -
                        detailsData.paid_totalAmount,
                      transactions_data: detailsData.transactions_data,
                    });
                  },
                  (error) => {
                    console.log(error);
                    //Done
                    res({ total: 0, transactions_data: null });
                  }
                );
              } //No paid requests yet - send the current total found
              else {
                res({
                  total:
                    detailsData.topedupAmount - detailsData.paid_totalAmount,
                  transactions_data: detailsData.transactions_data,
                });
              }
            });
        } //No topups records found - so null wallet
        else {
          res({ total: 0, transactions_data: null });
        }
      });
  }).then(
    (result) => {
      //Cache and reply
      client.setex(
        redisKey,
        process.env.REDIS_EXPIRATION_5MIN,
        JSON.stringify(result)
      );
      //Reply
      resolve(result);
    },
    (error) => {
      console.log(error);
      //Error - empty wallet -cache
      client.setex(
        redisKey,
        process.env.REDIS_EXPIRATION_5MIN,
        JSON.stringify({ total: 0, transactions_data: null })
      );
      //Reply
      resolve({ total: 0, transactions_data: null });
    }
  );
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
    console.log(error);
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
          last_updated: chaineDateUTC,
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
                  date: chaineDateUTC,
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
          last_updated: chaineDateUTC,
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
                  date: chaineDateUTC,
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
          last_updated: chaineDateUTC,
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
                  date: chaineDateUTC,
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
          last_updated: chaineDateUTC,
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
                  date: chaineDateUTC,
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
      console.log("Initialize the phone number change");
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
        console.log(body);
        if (error === null) {
          try {
            body = JSON.parse(body);
            if (
              body.response !== undefined &&
              body.response !== null &&
              body.response
            ) {
              //Verified
              console.log("NUMBER VERIFIEDD!");
              //Acceptable
              let filter = {
                user_fingerprint: requestData.user_fingerprint,
              };
              let updateData = {
                $set: {
                  phone_number: /^\+/i.test(requestData.dataToUpdate.trim())
                    ? requestData.dataToUpdate.trim()
                    : `+${requestData.dataToUpdate.trim()}`,
                  last_updated: chaineDateUTC,
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
                          date: chaineDateUTC,
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
        fs.writeFile(
          `${process.env.RIDERS_PROFILE_PICTURES_PATH}/${tmpPicture_name}`,
          requestData.dataToUpdate,
          "base64",
          function (err) {
            if (err) {
              resolve({
                response: "error",
                flag: "unexpected_conversion_error",
              });
            }
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
                    .find({ user_fingerprint: requestData.user_fingerprint })
                    .toArray(function (error, riderData) {
                      if (error) {
                        res(false);
                      }
                      //...
                      if (riderData.length > 0) {
                        //Valid
                        let dataEvent = {
                          event_name: "rider_profile_picture_update",
                          user_fingerprint: requestData.user_fingerprint,
                          old_data: riderData[0].media.profile_picture,
                          new_data: tmpPicture_name,
                          date: chaineDateUTC,
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
                resolve({ response: "success", flag: "operation successful" });
              }
            );
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
      console.log(error);
      resolve({ response: "error", flag: "unexpected_conversion_error" });
    }
  }
  //Error - invalid data
  else {
    resolve({ response: "error", flag: "invalid_data" });
  }
}

/**
 * MAIN
 */

clientMongo.connect(function (err) {
  //if (err) throw err;
  console.log("[+] Account services active.");
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
      res.send("Account services up");
    })
    .use(bodyParser.json({ limit: "100mb", extended: true }))
    .use(bodyParser.urlencoded({ limit: "100mb", extended: true }))
    .use(bodyParser.urlencoded({ extended: true }));

  /**
   * GENERATE OTP AND CHECK THE USER EXISTANCE
   * Responsible for generating an otp and checking whether a user was already registered or not.
   * If already registered send also the user fingerprint.
   */
  app.get("/sendOTPAndCheckUserStatus", function (req, res) {
    resolveDate();
    let params = urlParser.parse(req.url, true);
    console.log(params);
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
          `<#> ` +
          otp +
          ` is your TaxiConnect Verification Code. ${
            req.smsHashLinker !== undefined && req.smsHashLinker !== null
              ? req.smsHashLinker
              : "QEg7axwB9km"
          }`;
        SendSMSTo(req.phone_number, message);
        res0(true);
        //SMS
      }).then(
        () => {},
        (error) => {}
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
          //Save otp in profile if the user was already registered
          if (
            result.response !== undefined &&
            req.user_fingerprint !== undefined &&
            req.user_fingerprint !== null
          ) {
            console.log(
              `OTP secret saved in rider's profile - ${req.user_fingerprint}`
            );
            //Registered user
            new Promise((res2) => {
              let secretData = {
                $set: {
                  "account_verifications.phone_verification_secrets": {
                    otp: otp,
                    date_sent: chaineDateUTC,
                  },
                },
              };
              //.
              collectionPassengers_profiles.updateOne(
                { user_fingerprint: req.user_fingerprint },
                secretData,
                function (err, reslt) {
                  res2(true);
                }
              );
            }).then(
              () => {},
              () => {}
            );
          }
          //...
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
        if (
          req.userType === undefined ||
          req.userType === null ||
          /^unregistered$/i.test(req.userType.trim())
        ) {
          //Checking for unregistered users
          let checkOTP = {
            phone_number: req.phone_number,
            otp: req.otp,
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
          let checkOTP = {
            user_fingerprint: req.user_fingerprint,
            "account_verifications.phone_verification_secrets.otp": req.otp,
          };
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
                res0({ response: false });
              }
            });
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
              media: {
                profile_picture: "default_male.jpg",
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
                date: chaineDateUTC,
              },
              date_registered: {
                date: chaineDateUTC,
              },
            };
            console.log(minimalAccount);
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
          console.log(error);
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
      //..
      new Promise((res0) => {
        let findProfile = {
          user_fingerprint: req.user_fingerprint,
        };
        let updateProfile = {
          $set: {
            name: req.name,
            email: req.email,
            gender: req.gender,
            last_updated: chaineDateUTC,
          },
        };
        //Update
        collectionPassengers_profiles.updateOne(
          findProfile,
          updateProfile,
          function (error, result) {
            if (error) {
              res0({
                response: "error_adding_additional_profile_details_new_account",
              });
            }
            res0({
              response: "updated",
              name: req.name,
              email: req.email,
              gender: req.gender,
            });
          }
        );
      }).then(
        (result) => {
          res.send(result);
        },
        (error) => {
          res.send({
            response: "error_adding_additional_profile_details_new_account",
          });
        }
      );
    }
    //Error - missing details
    else {
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
    console.log(req);

    if (req.user_fingerprint !== undefined && req.user_fingerprint !== null) {
      //Valid
      if (
        req.target !== undefined &&
        req.target !== null &&
        req.request_fp !== undefined &&
        req.request_fp !== null
      ) {
        console.log("here");
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
            console.log(result);
            res.send(result);
          },
          (error) => {
            console.log(error);
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
            console.log(result);
            res.send(result);
          },
          (error) => {
            console.log(error);
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
    resolveDate();
    let params = urlParser.parse(req.url, true);
    req = params.query;
    console.log(req);

    if (
      req.driver_fingerprint !== undefined &&
      req.driver_fingerprint !== null
    ) {
      new Promise((res0) => {
        getDaily_requestAmount_driver(
          collectionRidesDeliveryData,
          collectionDrivers_profiles,
          req.driver_fingerprint,
          res0
        );
      }).then(
        (result) => {
          res.send(result);
        },
        (error) => {
          console.log(error);
          res.send({
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
      res.send({
        amount: 0,
        currency: "NAD",
        currency_symbol: "N$",
        supported_requests_types: "none",
        response: "error",
      });
    }
  });

  /**
   * Go ONLINE/OFFLINE FOR DRIVERS
   * Responsible for going online or offline for drivers / or getting the operational status of drivers (online/offline).
   * @param driver_fingerprint
   * @param state: online or offline
   */
  app.get("/goOnline_offlineDrivers", function (req, res) {
    resolveDate();
    let params = urlParser.parse(req.url, true);
    req = params.query;
    console.log(req);

    if (
      req.driver_fingerprint !== undefined &&
      req.driver_fingerprint !== null &&
      req.action !== undefined &&
      req.action !== null &&
      req.state !== undefined &&
      req.state !== null
    ) {
      if (/make/i.test(req.action)) {
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
                                event_name: "driver_switching_status_request",
                                status: /online/i.test(req.state)
                                  ? "online"
                                  : "offline",
                                driver_fingerprint: req.driver_fingerprint,
                                date: chaineDateUTC,
                              });
                              res(true);
                            }).then(
                              () => {},
                              () => {}
                            );
                            //Done
                            res0({
                              response: "successfully_done",
                              flag: /online/i.test(req.state)
                                ? "online"
                                : "offline",
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
                              date: chaineDateUTC,
                            });
                            res(true);
                          }).then(
                            () => {},
                            () => {}
                          );
                          //Done
                          res0({
                            response: "successfully_done",
                            flag: /online/i.test(req.state)
                              ? "online"
                              : "offline",
                          });
                        }
                      );
                    }
                  });
                //Found a driver
                let updateData = {
                  $set: {
                    "operational_state.status": /online/i.test(req.state)
                      ? "online"
                      : "offline",
                  },
                };
              } //Error - unknown driver
              else {
                res0({ response: "error_invalid_request" });
              }
            });
        }).then(
          (result) => {
            res.send(result);
          },
          (error) => {
            console.log(error);
            res.send({ response: "error_invalid_request" });
          }
        );
      } else if (/get/i.test(req.action)) {
        //Get information about the state
        new Promise((res0) => {
          collectionDrivers_profiles
            .find({ driver_fingerprint: req.driver_fingerprint })
            .toArray(function (err, driverData) {
              if (err) {
                res0({ response: "error_invalid_request" });
              }
              //...
              if (driverData.length > 0) {
                driverData = driverData[0];
                //Valid driver
                res0({
                  response: "successfully_got",
                  flag: driverData.operational_state.status,
                });
              } //Unknown driver
              else {
                res0({ response: "error_invalid_request" });
              }
            });
        }).then(
          (result) => {
            res.send(result);
          },
          (error) => {
            console.log(error);
            res.send({ response: "error_invalid_request" });
          }
        );
      }
    } //Invalid data
    else {
      res.send({ response: "error_invalid_request" });
    }
  });

  /**
   * COMPUTE WALLET SUMMARY FOR RIDERS
   * Responsible for computing the wallet summary (total and details) for the riders.
   * Supports 2 modes: total (will only return the current total wallet balance) or detailed (will return the total amount and the list of all wallet transactions)
   */
  app.get("/getRiders_walletInfos", function (req, res) {
    resolveDate();
    let params = urlParser.parse(req.url, true);
    req = params.query;
    console.log(req);

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
          resolve
        );
      }).then(
        (result) => {
          res.send(
            regModeLimiter.test("detailed")
              ? result
              : result.total !== undefined
              ? { total: result.total }
              : { total: 0 }
          );
        },
        (error) => {
          console.log(error);
          res.send(
            regModeLimiter.test("detailed")
              ? { total: 0, transactions_data: null }
              : { total: 0 }
          );
        }
      );
    } //Invalid parameters
    else {
      res.send(
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

  /**
   * MODIFY PASSENGERS PROFILE DETAILS
   * Responsible for updating ANY information related to the passengers profile.
   * Informations that can be updated: name, surname, picture, email, phone number, gender.
   */
  app.post("/updateRiders_profileInfos", function (req, res) {
    //DEBUG DATA
    /*req.user_fingerprint =
      "7c57cb6c9471fd33fd265d5441f253eced2a6307c0207dea57c987035b496e6e8dfa7105b86915da";
    req.infoToUpdate = "picture";
    req.dataToUpdate = `data:image/jpeg;base64,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`;
    */
    //DEBUG DATA---
    resolveDate();
    req = req.body;
    console.log(req);

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
});

server.listen(process.env.ACCOUNTS_SERVICE_PORT);
