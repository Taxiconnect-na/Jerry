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
  } //Other - default
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
      (String(dateRequest).date().length > 1
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
 * @param resolve
 */
function getDaily_requestAmount_driver(
  collectionRidesDeliveryData,
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
 * @param resolve
 */
function exec_computeDaily_amountMade(
  collectionRidesDeliveryData,
  driver_fingerprint,
  resolve
) {
  resolveDate();
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
        response: "success",
      });
    });
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
        response: "error",
      });
    }
  });
});

server.listen(process.env.ACCOUNTS_SERVICE_PORT);
