require("dotenv").config();
//var dash = require("appmetrics-dash");
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
//....
var fastFilter = require("fast-filter");
const { promisify, inspect } = require("util");
const urlParser = require("url");
const redis = require("redis");
const geolib = require("geolib");
redis.createClient({
  host: process.env.REDIS_HOST,
  port: process.env.REDIS_PORT,
});
const redisGet = promisify(client.get).bind(client);

var chaineDateUTC = null;
var dateObject = null;
const moment = require("moment");
const e = require("express");
const { resolve } = require("dns");
const { stringify, parse } = require("flatted");

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

//--------------DRIVER'S DEBUG DATA-------------------------------------------------------------------
/*const driverCacheData = {
  user_fingerprint:
    "23c9d088e03653169b9c18193a0b8dd329ea1e43eb0626ef9f16b5b979694a429710561a3cb3ddae",
  latitude: -22.567989,
  longitude: 17.084384,
  date_logged: chaineDateUTC,
};
//Cache
//console.log("[1] Initialize debug data in cache");
client.set(
  driverCacheData.user_fingerprint,
  JSON.stringify(driverCacheData),
  redis.print
);*/
//-----------------------------------------------------------------------------------------------------

function logObject(obj) {
  //console.log(inspect(obj, { maxArrayLength: null, depth: null, showHidden: true, colors: true }));
}

function logToSimulator(socket, data) {
  socket.emit("updateTripLog", { logText: data });
}

/**
 * Responsible for finding vital ETA and route informations from one point
 * to another.
 * @param simplifiedResults: to only return the ETA and distance infos
 * @param cache: to cache the results to the provided REDIS key at the provided value index, DO NOT OVERWRITE
 */
function getRouteInfosDestination(
  coordsInfos,
  resolve,
  simplifiedResults = false,
  cache = false
) {
  let destinationPosition = coordsInfos.destination;
  let passengerPosition = coordsInfos.passenger;
  let url =
    process.env.URL_ROUTE_SERVICES +
    "point=" +
    passengerPosition.latitude +
    "," +
    passengerPosition.longitude +
    "&point=" +
    destinationPosition.latitude +
    "," +
    destinationPosition.longitude +
    "&heading_penalty=0&avoid=residential&avoid=ferry&ch.disable=true&locale=en&details=street_name&details=time&optimize=true&points_encoded=false&details=max_speed&snap_prevention=ferry&profile=car&pass_through=true";
  //Add instructions if specified so
  if (
    coordsInfos.setIntructions !== undefined &&
    coordsInfos.setIntructions !== null &&
    coordsInfos.setIntructions
  ) {
    url += "&instructions=true";
  } //Remove instructions details
  else {
    url += "&instructions=false";
  }
  requestAPI(url, function (error, response, body) {
    if (body != undefined) {
      if (body.length > 20) {
        try {
          body = JSON.parse(body);
          if (body.paths[0].distance != undefined) {
            let distance = body.paths[0].distance;
            let eta =
              body.paths[0].time / 1000 >= 60
                ? Math.round(body.paths[0].time / 60000) + " min away"
                : Math.round(body.paths[0].time / 1000) + " sec away"; //Sec
            //...
            if (cache !== false) {
              //Update the cache
              //Check for previous redis record
              new Promise((res) => {
                redisGet(cache.redisKey).then(
                  (resp) => {
                    if (resp !== null) {
                      //Has a record, update the provided value inddex with the result
                      try {
                        resp = JSON.parse(resp);
                        resp[cache.valueIndex] = {
                          eta: eta,
                          distance: distance,
                        };
                        client.set(cache.redisKey, JSON.stringify(resp));
                        res(true);
                      } catch (error) {
                        //Write new record
                        let tmp = {};
                        tmp[cache.valueIndex] = {
                          eta: eta,
                          distance: distance,
                        };
                        client.set(cache.redisKey, JSON.stringify(tmp));
                        res(true);
                      }
                    } //Write brand new record
                    else {
                      let tmp = {};
                      tmp[cache.valueIndex] = {
                        eta: eta,
                        distance: distance,
                      };
                      client.set(cache.redisKey, JSON.stringify(tmp));
                      res(true);
                    }
                  },
                  (error) => {
                    //Skip caching
                    res(false);
                  }
                );
              }).then(
                () => {
                  //console.log("Updated relative eta cache.");
                },
                () => {}
              );
            }
            //...
            if (simplifiedResults === false) {
              var rawPoints = body.paths[0].points.coordinates;
              var pointsTravel = rawPoints;
              //=====================================================================
              resolve({
                routePoints: pointsTravel,
                driverNextPoint: pointsTravel[0],
                destinationPoint: [
                  destinationPosition.longitude,
                  destinationPosition.latitude,
                ],
                instructions:
                  coordsInfos.setIntructions !== undefined &&
                  coordsInfos.setIntructions !== null
                    ? body.paths[0].instructions
                    : null,
                eta: eta,
                distance: distance,
              });
            } //Simplify results
            else {
              //=====================================================================
              resolve({
                eta: eta,
                distance: distance,
              });
            }
          } else {
            resolve(false);
          }
        } catch (error) {
          resolve(false);
        }
      } else {
        resolve(false);
      }
    } else {
      resolve(false);
    }
  });
}

/**
 * @func getRouteInfos()
 * Inputs: coordsInfos, resolve
 * - coordsInfos: information about the user's location.
 * Get the route details for all the case scenarios
 * Scenarios: Route to pickup, route to destination
 * routeInfos is present to distinuish between pickup route requests, destinations route request or other scenarios
 * FOR DRIVERS AND PASSENGERS.
 * @distance : meters
 * @eta : minutes or seconds
 */
function getRouteInfos(coordsInfos, resolve) {
  let driverPosition =
    coordsInfos.driver === undefined
      ? coordsInfos.passenger_origin
      : coordsInfos.driver; //CAREFUL COULD BE THE PASSENGER'S ORIGIN POINT, especially useful when a request is still pending.
  let passengerPosition =
    coordsInfos.passenger === undefined
      ? coordsInfos.passenger_destination
      : coordsInfos.passenger; //CAREFUL COULD BE THE PASSENGER'S PICKUP LOCATION OF DESTINATION (ref. to the app code).
  let destinationPosition =
    coordsInfos.destination === undefined ? false : coordsInfos.destination; //Deactive when a request is still in progress as the destination information is already contained in @var passenger_destination.
  /*if (coordsInfos.destination !== undefined) {
    destinationPosition = coordsInfos.destination;
  }*/

  url =
    process.env.URL_ROUTE_SERVICES +
    "point=" +
    driverPosition.latitude +
    "," +
    driverPosition.longitude +
    "&point=" +
    passengerPosition.latitude +
    "," +
    passengerPosition.longitude +
    "&heading_penalty=0&avoid=residential&avoid=ferry&ch.disable=true&locale=en&details=street_name&details=time&optimize=true&points_encoded=false&details=max_speed&snap_prevention=ferry&profile=car&pass_through=true&instructions=false";

  requestAPI(url, function (error, response, body) {
    if (body != undefined) {
      if (body.length > 20) {
        try {
          body = JSON.parse(body);
          if (body.paths[0].distance != undefined) {
            let distance = body.paths[0].distance;
            let eta =
              body.paths[0].time / 1000 >= 60
                ? Math.round(body.paths[0].time / 60000) + " min away"
                : Math.round(body.paths[0].time / 1000) + " sec away"; //Sec

            let rawPoints = body.paths[0].points.coordinates;
            let pointsTravel = rawPoints;
            //=====================================================================
            //Get destination's route infos
            if (destinationPosition !== false) {
              new Promise((res) => {
                let bundleData = {
                  passenger: passengerPosition,
                  destination: destinationPosition,
                };
                getRouteInfosDestination(
                  bundleData,
                  res,
                  false,
                  coordsInfos.redisKey
                );
              }).then(
                (result) => {
                  console.log("Ready to place");
                  if (
                    result !== false &&
                    result !== undefined &&
                    result != null
                  ) {
                    resolve({
                      routePoints: pointsTravel,
                      destinationData: result,
                      driverNextPoint: pointsTravel[0],
                      pickupPoint:
                        coordsInfos.passenger_origin === undefined
                          ? [
                              passengerPosition.longitude,
                              passengerPosition.latitude,
                            ]
                          : [driverPosition.longitude, driverPosition.latitude],
                      //driverNextPoint: pointsTravel[pointsTravel.length - 1],
                      eta: eta,
                      distance: distance,
                    });
                  } else {
                    resolve({
                      routePoints: pointsTravel,
                      destinationData: null,
                      pickupPoint:
                        coordsInfos.passenger_origin === undefined
                          ? [
                              passengerPosition.longitude,
                              passengerPosition.latitude,
                            ]
                          : [driverPosition.longitude, driverPosition.latitude],
                      driverNextPoint: pointsTravel[0],
                      eta: eta,
                      distance: distance,
                    });
                  }
                },
                () => {
                  resolve({
                    routePoints: pointsTravel,
                    destinationData: null,
                    pickupPoint:
                      coordsInfos.passenger_origin === undefined
                        ? [
                            passengerPosition.longitude,
                            passengerPosition.latitude,
                          ]
                        : [driverPosition.longitude, driverPosition.latitude],
                    driverNextPoint: pointsTravel[0],
                    eta: eta,
                    distance: distance,
                  });
                }
              );
            } else {
              resolve({
                routePoints: pointsTravel,
                destinationData:
                  coordsInfos.passenger_destination === undefined
                    ? "routeTracking"
                    : "requestToDestinationTracking_pending", //Check whether the request is still pending (requestToDest...) or is accepted and is in progress (routeTracking)
                driverNextPoint: pointsTravel[0],
                pickupPoint:
                  coordsInfos.passenger_origin === undefined
                    ? [passengerPosition.longitude, passengerPosition.latitude]
                    : [driverPosition.longitude, driverPosition.latitude],
                destinationPoint: [
                  passengerPosition.longitude,
                  passengerPosition.latitude,
                ],
                eta: eta,
                distance: distance,
              });
            }
          } else {
            resolve(false);
          }
        } catch (error) {
          resolve(false);
        }
      } else {
        resolve(false);
      }
    } else {
      resolve(false);
    }
  });
}

/**
 * @func updateRidersRealtimeLocationData()
 * @params mongoCollection, collectionRidersLocation_log, collectionDrivers_profiles, locationData
 * Update the rider's location informations in monogDB everytime a change occurs in the rider's app
 * related to the positioning.
 * Use promises as much as possible.
 */
function updateRidersRealtimeLocationData(
  collectionRidersLocation_log,
  collectionDrivers_profiles,
  collectionPassengers_profiles,
  locationData,
  resolve
) {
  resolveDate();
  //Update location log for riders
  new Promise((res) => {
    updateRiderLocationsLog(
      collectionRidersLocation_log,
      collectionDrivers_profiles,
      collectionPassengers_profiles,
      locationData,
      res
    );
  }).then(
    () => {
      resolve(true);
    },
    () => {
      resolve(false);
    }
  );
}

/**
 * @func updateRiderLocationsLog()
 * @params  collectionRidersLocation_log, collectionDrivers_profiles,  locationData, resolve
 * Responsible for updating any rider location change received.
 * Avoid duplicates as much as possible.
 */
function updateRiderLocationsLog(
  collectionRidersLocation_log,
  collectionDrivers_profiles,
  collectionPassengers_profiles,
  locationData,
  resolve
) {
  resolveDate();
  if (/rider/i.test(locationData.user_nature)) {
    //Riders handler
    //! Update the pushnotfication token
    collectionPassengers_profiles.updateOne(
      {
        user_fingerprint: locationData.user_fingerprint,
      },
      {
        $set: {
          pushnotif_token: locationData.pushnotif_token,
        },
      },
      function (err, res) {
        if (err) {
          console.log(err);
        }
      }
    );
    //Check if new
    collectionRidersLocation_log
      .find({
        user_fingerprint: locationData.user_fingerprint,
        coordinates: {
          latitude: locationData.latitude,
          longitude: locationData.longitude,
        },
      })
      .toArray(function (err, res) {
        if (res.length == 0) {
          //New record
          let dataBundle = {
            user_fingerprint: locationData.user_fingerprint,
            coordinates: {
              latitude: locationData.latitude,
              longitude: locationData.longitude,
            },
            date_logged: new Date(chaineDateUTC),
          };
          collectionRidersLocation_log.insertOne(
            dataBundle,
            function (err, res) {
              resolve(true);
            }
          );
        } else {
          resolve(true);
        }
      });
  } else if (/driver/i.test(locationData.user_nature)) {
    //Drivers handler
    //Update the driver's operstional position
    let filterDriver = {
      driver_fingerprint: locationData.user_fingerprint,
    };
    //! Update the pushnotfication token
    collectionDrivers_profiles.updateOne(
      filterDriver,
      {
        $set: {
          "operational_state.push_notification_token":
            locationData.pushnotif_token,
        },
      },
      function (err, res) {
        if (err) {
          console.log(err);
        }
      }
    );
    //First get the current coordinate
    collectionDrivers_profiles
      .find(filterDriver)
      .toArray(function (err, driverData) {
        if (err) {
          console.log(err);
          resolve(false);
        }
        //...
        if (driverData.length > 0) {
          if (
            driverData !== undefined &&
            driverData !== null &&
            driverData[0] !== undefined &&
            driverData[0] !== null &&
            driverData[0].operational_state !== undefined &&
            driverData[0].operational_state !== null &&
            driverData[0].operational_state.last_location !== null &&
            driverData[0].operational_state.last_location !== undefined &&
            driverData[0].operational_state.last_location.coordinates !==
              undefined
          ) {
            //Get the previous location
            if (
              driverData[0].operational_state.last_location.prev_coordinates !==
              undefined
            ) {
              //? Here it gets the current coords which are becoming prev.
              let prevCoordsWhichWasNewHere =
                driverData[0].operational_state.last_location.coordinates;
              //...
              let dataBundle = {
                $set: {
                  "operational_state.last_location.coordinates": {
                    latitude: locationData.latitude,
                    longitude: locationData.longitude,
                  },
                  "operational_state.last_location.prev_coordinates": prevCoordsWhichWasNewHere,
                  "operational_state.last_location.date_updated": new Date(
                    chaineDateUTC
                  ),
                  date_updated: new Date(chaineDateUTC),
                },
              };
              collectionDrivers_profiles.updateOne(
                filterDriver,
                dataBundle,
                function (err, res) {
                  //! Update the city and the country
                  new Promise((resUpdateRest) => {
                    completeLastLoccation_infosSubsAndRest(
                      locationData,
                      collectionDrivers_profiles,
                      resUpdateRest
                    );
                  }).then(
                    () => {},
                    () => {}
                  );
                  resolve(true);
                }
              );
            } //No previous location -- update current location and prev to the same value
            else {
              let dataBundle = {
                $set: {
                  "operational_state.last_location": {
                    coordinates: {
                      latitude: locationData.latitude,
                      longitude: locationData.longitude,
                    },
                    prev_coordinates: {
                      latitude: locationData.latitude,
                      longitude: locationData.longitude,
                    },
                    date_updated: new Date(chaineDateUTC),
                    date_logged: new Date(chaineDateUTC),
                  },
                },
              };
              collectionDrivers_profiles.updateOne(
                filterDriver,
                dataBundle,
                function (err, res) {
                  //! Update the city and the country
                  new Promise((resUpdateRest) => {
                    completeLastLoccation_infosSubsAndRest(
                      locationData,
                      collectionDrivers_profiles,
                      resUpdateRest
                    );
                  }).then(
                    () => {},
                    () => {}
                  );
                  resolve(true);
                }
              );
            }
          } //No location data yet - update the previous location and current to the same value
          else {
            //! Auto initialize fields
            let dataBundle = {
              $set: {
                "operational_state.last_location": {
                  coordinates: {
                    latitude: locationData.latitude,
                    longitude: locationData.longitude,
                  },
                  prev_coordinates: {
                    latitude: locationData.latitude,
                    longitude: locationData.longitude,
                  },
                  date_updated: new Date(chaineDateUTC),
                  date_logged: new Date(chaineDateUTC),
                },
              },
            };
            collectionDrivers_profiles.updateOne(
              filterDriver,
              dataBundle,
              function (err, res) {
                console.log(err);
                //! Update the city and the country
                new Promise((resUpdateRest) => {
                  completeLastLoccation_infosSubsAndRest(
                    locationData,
                    collectionDrivers_profiles,
                    resUpdateRest
                  );
                }).then(
                  () => {},
                  () => {}
                );
                resolve(true);
              }
            );
          }
        } //No record - strange
        else {
          resolve(false);
        }
      });
  }
}

/**
 * @func completeLastLoccation_infosSubsAndRest
 * Responsible for completing the last location data like city, country and suburb if any.
 * ? Makes sense for the drivers only.
 * @param locationData: the bundle containing the user's location and coordinates.
 * @param collectionDrivers_profiles: list of all the drivers.
 * @param resolve
 */
function completeLastLoccation_infosSubsAndRest(
  locationData,
  collectionDrivers_profiles,
  resolve
) {
  //? Prepare the obj
  let objFinal = {
    city: null,
    country: null,
    street: null,
    suburb: null,
    location_name: null,
    geographic_extent: null,
  };
  //1. Get the general location infos
  let url =
    process.env.LOCAL_URL +
    ":" +
    process.env.MAP_SERVICE_PORT +
    "/getUserLocationInfos?latitude=" +
    locationData.latitude +
    "&longitude=" +
    locationData.longitude +
    "&user_fingerprint=" +
    locationData.user_fingerprint;
  requestAPI(url, function (error, response, body) {
    if (error === null) {
      try {
        body = JSON.parse(body);
        //? Partially complete the final object
        objFinal.city = body.city;
        objFinal.country = body.country;
        objFinal.street = body.street !== undefined ? body.street : false;
        objFinal.location_name = body.name;
        objFinal.geographic_extent =
          body.extent !== undefined ? body.extent : false;
        //1. Get the suburb
        let url =
          process.env.LOCAL_URL +
          ":" +
          process.env.PRICING_SERVICE_PORT +
          "/getCorrespondingSuburbInfos?location_name=" +
          objFinal.location_name +
          "&street_name=" +
          objFinal.street +
          "&city=" +
          objFinal.city +
          "&country=" +
          objFinal.country +
          "&latitude=" +
          locationData.latitude +
          "&longitude=" +
          locationData.longitude +
          "&user_fingerprint=" +
          locationData.user_fingerprint;
        requestAPI(url, function (error, response, body) {
          if (error === null) {
            try {
              body = JSON.parse(body);
              console.log(body);
              //? Complete the suburb data
              objFinal.suburb = body.suburb !== undefined ? body.suburb : false;
              //Update the user's profile
              if (
                objFinal.city !== null &&
                objFinal.country !== null &&
                objFinal.city !== "null" &&
                objFinal.country !== "null" &&
                objFinal.city !== undefined &&
                objFinal.country !== undefined &&
                objFinal.city !== "undefined" &&
                objFinal.country !== "undefined"
              ) {
                //! Avoid to overwrite good values by nulls
                collectionDrivers_profiles.updateOne(
                  {
                    driver_fingerprint: locationData.user_fingerprint,
                  },
                  {
                    $set: {
                      "operational_state.last_location.city": objFinal.city,
                      "operational_state.last_location.country":
                        objFinal.country,
                      "operational_state.last_location.suburb": objFinal.suburb,
                      "operational_state.last_location.street": objFinal.street,
                      "operational_state.last_location.location_name":
                        objFinal.location_name,
                      "operational_state.last_location.geographic_extent":
                        objFinal.geographic_extent,
                    },
                  },
                  function (err, res) {
                    console.log(err);
                    resolve(true);
                  }
                );
              } else {
                resolve(false);
              }
            } catch (error) {
              resolve(false);
            }
          } else {
            resolve(false);
          }
        });
      } catch (error) {
        resolve(false);
      }
    } else {
      resolve(false);
    }
  });
}

/**
 * @func tripChecker_Dispatcher()
 * inputs:
 * collectionRidesDeliveries_data: rider's front metadata
 * user_fingerprint: fingerprint of the user requesting the information
 * user_nature: rider or driver
 * Responsible for finding out if there is any trip in progress linked to the user fingerprint
 * and dispatch accordingly the information to the correct driver and rider
 * @var isArrivedToDestination
 * @true when the passenger confirms his/her drop off
 * @var isRideCompleted_driverSide
 * @param collectionDrivers_profiles: list of all the drivers
 * @param collectionPassengers_profiles: the list of all the passengers profiles.
 * @param requestType: ONLY FOR DRIVERS - ride, delivery or scheduled
 * @true when the driver confirms that the trip is over from his/her side
 * REQUEST STATUS: pending, inRouteToPickup, inRouteToDropoff, completedDriverConfimed
 */
function tripChecker_Dispatcher(
  collectionRidesDeliveries_data,
  collectionDrivers_profiles,
  collectionPassengers_profiles,
  user_fingerprint,
  user_nature,
  requestType = "ride",
  resolve
) {
  if (/^rider$/i.test(user_nature)) {
    //Check if the user has a pending request
    let rideChecker = {
      client_id: { $regex: user_fingerprint },
      "ride_state_vars.isRideCompleted_riderSide": false,
    };
    console.log(rideChecker);
    collectionRidesDeliveries_data
      .find(rideChecker)
      .toArray(function (err, userDataRepr) {
        if (err) {
          resolve(false);
          throw err;
        }
        if (userDataRepr.length <= 0) {
          //No data
          resolve(false);
        } //Found a user record
        else {
          //...
          if (
            userDataRepr[0].ride_state_vars.isRideCompleted_riderSide === false
          ) {
            //REQUEST FP
            let request_fp = userDataRepr[0].request_fp;
            //Check if there are any requests cached
            getMongoRecordTrip_cacheLater(
              collectionRidesDeliveries_data,
              collectionDrivers_profiles,
              user_fingerprint,
              user_nature,
              request_fp,
              resolve
            );
          } //No rides recorded
          else {
            resolve("no_rides");
          }
        }
      });
  } else if (/^driver$/i.test(user_nature)) {
    //Get the driver's details
    collectionDrivers_profiles
      .find({
        driver_fingerprint: user_fingerprint,
        "operational_state.status": { $regex: /online/, $options: "i" },
      })
      .toArray(function (err, driverData) {
        if (err) {
          resolve(false);
        }
        //
        if (driverData.length <= 0) {
          resolve(false);
        }
        driverData = driverData[0];
        //...
        //Check if the driver has an accepted and not completed request already
        let checkRide0 = {
          taxi_id: user_fingerprint,
          "ride_state_vars.isAccepted": true,
          "ride_state_vars.isRideCompleted_driverSide": false,
          isArrivedToDestination: false,
          ride_mode:
            /scheduled/i.test(requestType) === false
              ? { $regex: requestType, $options: "i" }
              : {
                  $in: [
                    ...driverData.operation_clearances,
                    ...driverData.operation_clearances.map((mode) =>
                      mode.toUpperCase()
                    ),
                  ],
                },
          allowed_drivers_see: user_fingerprint,
          intentional_request_decline: { $not: { $regex: user_fingerprint } },
        };

        collectionRidesDeliveries_data
          .find(checkRide0)
          .toArray(function (err, acceptedRidesArray) {
            if (err) {
              resolve(false);
            }
            //...
            if (
              acceptedRidesArray !== undefined &&
              acceptedRidesArray.length > 0
            ) {
              //Has accepted some rides already
              //1. Check if he has accepted an unconfirmed driver's side connectMe request or not.
              //a. If yes, only send the uncompleted connectMe request
              //b. If not, send the current accepted requests AND add on top additional new allowed see rides.
              let checkRide1 = {
                taxi_id: user_fingerprint,
                connect_type: { $regex: "ConnectMe", $options: "i" },
                "ride_state_vars.isRideCompleted_driverSide": false,
                ride_mode:
                  /scheduled/i.test(requestType) === false
                    ? { $regex: requestType, $options: "i" }
                    : {
                        $in: [
                          ...driverData.operation_clearances,
                          ...driverData.operation_clearances.map((mode) =>
                            mode.toUpperCase()
                          ),
                        ],
                      },
                allowed_drivers_see: user_fingerprint,
                intentional_request_decline: {
                  $not: { $regex: user_fingerprint },
                },
              };
              collectionRidesDeliveries_data
                .find(checkRide1)
                .toArray(function (err, result1) {
                  if (err) {
                    resolve(false);
                  }
                  //...
                  if (result1.length > 0) {
                    console.log("PENDING_CONNECTME");
                    //Has an uncompleted connectMe request - only send this connectMe request until it is completed
                    new Promise((res) => {
                      execGetDrivers_requests_and_provide(
                        driverData,
                        requestType,
                        "PENDING_CONNECTME",
                        result1,
                        collectionRidesDeliveries_data,
                        collectionPassengers_profiles,
                        res
                      );
                    }).then(
                      (resultFinal) => {
                        resolve(resultFinal);
                      },
                      (error) => {
                        console.log(error);
                        resolve(false);
                      }
                    );
                  } //Has no uncompleted connectMe requests - so, send the accepted requests and add additional virgin allowed to see rides
                  else {
                    console.log("ACCEPTED_AND_ADDITIONAL_REQUESTS");
                    new Promise((res) => {
                      execGetDrivers_requests_and_provide(
                        driverData,
                        requestType,
                        "ACCEPTED_AND_ADDITIONAL_REQUESTS",
                        acceptedRidesArray,
                        collectionRidesDeliveries_data,
                        collectionPassengers_profiles,
                        res
                      );
                    }).then(
                      (resultFinal) => {
                        resolve(resultFinal);
                      },
                      (error) => {
                        console.log(error);
                        resolve(false);
                      }
                    );
                  }
                });
            } //NO rides already accepted yet - send full list of allowed to see rides
            else {
              console.log("FULL_ALLLOWEDTOSEE_REQUESTS");
              new Promise((res) => {
                execGetDrivers_requests_and_provide(
                  driverData,
                  requestType,
                  "FULL_ALLLOWEDTOSEE_REQUESTS",
                  false,
                  collectionRidesDeliveries_data,
                  collectionPassengers_profiles,
                  res
                );
              }).then(
                (resultFinal) => {
                  resolve(resultFinal);
                },
                (error) => {
                  console.log(error);
                  resolve(false);
                }
              );
            }
          });
      });
  }
  //Malformed
  else {
    resolve(false);
  }
}

/**
 * @func sharedTripChecker_Dispatcher
 * inputs:
 * collectionRidesDeliveries_data: rider's front metadata
 * user_fingerprint: fingerprint of the user requesting the information
 * user_nature: rider or driver
 * Responsible for finding out if there is any shared trip in progress linked to the user fingerprint
 * and dispatch accordingly the information to only rider to which the link was shared to.
 * @var isArrivedToDestination
 * @true when the passenger confirms his/her drop off
 * @var isRideCompleted_driverSide
 * @param collectionDrivers_profiles: list of all the drivers
 * @param collectionPassengers_profiles: the list of all the passengers profiles.
 * @param requestType: ONLY FOR DRIVERS - ride, delivery or scheduled
 * @true when the driver confirms that the trip is over from his/her side
 * REQUEST STATUS: pending, inRouteToPickup, inRouteToDropoff, completedDriverConfimed
 */
function sharedTripChecker_Dispatcher(
  collectionRidesDeliveries_data,
  collectionDrivers_profiles,
  collectionPassengers_profiles,
  user_fingerprint,
  user_nature,
  requestType = "ride",
  resolve
) {
  console.log("share the trip action");
}

/**
 * @func execGetDrivers_requests_and_provide
 * Responsible for getting all driver's requests based on the following 3 scenarios:
 * ? 1. PENDING_CONNECTME: when the driver has an uncompleted connectMe request in progress.
 * ? 2. ACCEPTED_AND_ADDITIONAL_REQUESTS: when the driver has already accepted some requests, and add on top of that some new allowed to see requests.
 * ? 3. FULL_ALLLOWEDTOSEE_REQUESTS: when the driver haven't accepted any requests yet, return a full list of maximum allowed to see requests based on the car capacity.
 * Limit the number of requests to the maximum capacity of the car + 3
 * Return requests based on the type of car supported.
 * Return requests based on the destination type : private location, taxi rank or airport.
 * @param driverData: the driver's complete information.
 * @param requestType: the type of request to get - ride, delivery or scheduled - default: rides
 * @param scenarioString: one of the 3 enumerated scenarios.
 * @param alreadyFetchedData: the requests already fetched from the @func tripChecker_Dispatcher function to avoid repetition.
 * @param collectionRidesDeliveries_data: the list of all the requests made
 * @param collectionPassengers_profiles: the list of all the passengers profiles.
 * @param resolve
 */
function execGetDrivers_requests_and_provide(
  driverData,
  requestType,
  scenarioString,
  alreadyFetchedData,
  collectionRidesDeliveries_data,
  collectionPassengers_profiles,
  resolve
) {
  if (/PENDING_CONNECTME/i.test(scenarioString)) {
    //Scenario 1
    //Just send the alreadyFetchedData for the connectMe
    //PARSE THE FINAL REQUESTS
    new Promise((res) => {
      parseRequests_forDrivers_view(
        alreadyFetchedData,
        collectionPassengers_profiles,
        driverData,
        res
      );
    }).then(
      (resultFinal) => {
        resolve(resultFinal);
      },
      (error) => {
        console.log(error);
        resolve(false);
      }
    );
  } else if (/ACCEPTED_AND_ADDITIONAL_REQUESTS/i.test(scenarioString)) {
    //Scenario 2
    let request_type_regex = /scheduled/i.test(requestType)
      ? "scheduled"
      : "immediate"; //For scheduled requests display or not.
    let requestFilter = {
      taxi_id: false,
      "ride_state_vars.isAccepted": false,
      "ride_state_vars.isRideCompleted_driverSide": false,
      isArrivedToDestination: false,
      allowed_drivers_see: driverData.driver_fingerprint,
      intentional_request_decline: {
        $not: { $regex: driverData.driver_fingerprint },
      },
      carTypeSelected: {
        $regex: driverData.operational_state.default_selected_car.vehicle_type,
        $options: "i",
      },
      country: {
        $regex: driverData.operational_state.last_location.country,
        $options: "i",
      },
      "pickup_location_infos.city": {
        $regex: driverData.operational_state.last_location.city,
        $options: "i",
      },
      //ride_mode: { $regex: requestType, $options: "i" }, //ride, delivery
      request_type: { $regex: request_type_regex, $options: "i" }, //Shceduled or now rides/deliveries
    };
    //...
    collectionRidesDeliveries_data
      .find(requestFilter)
      .toArray(function (err, requestsData) {
        if (err) {
          resolve(false);
        }
        //...
        if (requestsData.length > 0) {
          //Found some data
          //1. Filter the requests based on the clearances of the driver - ride/delivery
          let clearancesString = driverData.operation_clearances.join(",");
          let max_passengers_capacity =
            driverData.operational_state.default_selected_car.max_passengers;
          //...
          let refinedRequests = requestsData.filter((request) => {
            let tmpReg = new RegExp(request.ride_mode, "i");
            return tmpReg.test(clearancesString);
          });
          //2. ADD THE ALREADY ACCEPTED REQUESTS IN FRONT
          refinedRequests = [...alreadyFetchedData, ...refinedRequests];
          //Slice based on the max capacity
          refinedRequests = refinedRequests.slice(0, max_passengers_capacity);
          //...
          //PARSE THE FINAL REQUESTS
          new Promise((res) => {
            parseRequests_forDrivers_view(
              refinedRequests,
              collectionPassengers_profiles,
              driverData,
              res
            );
          }).then(
            (resultFinal) => {
              resolve(resultFinal);
            },
            (error) => {
              console.log(error);
              resolve(false);
            }
          );
        } //No requests - send the already accepted requests.
        else {
          //PARSE THE FINAL REQUESTS
          new Promise((res) => {
            parseRequests_forDrivers_view(
              alreadyFetchedData,
              collectionPassengers_profiles,
              driverData,
              res
            );
          }).then(
            (resultFinal) => {
              resolve(resultFinal);
            },
            (error) => {
              console.log(error);
              resolve(false);
            }
          );
        }
      });
  } else if (/FULL_ALLLOWEDTOSEE_REQUESTS/i.test(scenarioString)) {
    //Scenario 3
    //default_selected_car.[max_passengers, vehicle_type]
    let request_type_regex = /scheduled/i.test(requestType)
      ? "scheduled"
      : "immediate"; //For scheduled requests display or not.
    let requestFilter = {
      taxi_id: false,
      "ride_state_vars.isAccepted": false,
      "ride_state_vars.isRideCompleted_driverSide": false,
      allowed_drivers_see: driverData.driver_fingerprint,
      intentional_request_decline: {
        $not: { $regex: driverData.driver_fingerprint },
      },
      isArrivedToDestination: false,
      carTypeSelected: {
        $regex: driverData.operational_state.default_selected_car.vehicle_type,
        $options: "i",
      },
      country: {
        $regex:
          driverData.operational_state.last_location !== null &&
          driverData.operational_state.last_location !== undefined &&
          driverData.operational_state.last_location.country !== undefined &&
          driverData.operational_state.last_location.country != null
            ? driverData.operational_state.last_location.country
            : "Namibia",
        $options: "i",
      },
      "pickup_location_infos.city": {
        $regex:
          driverData.operational_state.last_location !== null &&
          driverData.operational_state.last_location !== undefined &&
          driverData.operational_state.last_location.city !== undefined &&
          driverData.operational_state.last_location.city != null
            ? driverData.operational_state.last_location.city
            : "Windhoek",
        $options: "i",
      },
      request_type: { $regex: request_type_regex, $options: "i" }, //Shceduled or immediate rides/deliveries
    };
    console.log(requestFilter);
    //...
    collectionRidesDeliveries_data
      .find(requestFilter)
      .toArray(function (err, requestsData) {
        if (err) {
          resolve(false);
        }
        //...
        if (requestsData !== undefined && requestsData.length > 0) {
          //Found some data
          //! 1. Filter the requests based on the clearances of the driver - ride/delivery
          let clearancesString = driverData.operation_clearances.join(",");
          let max_passengers_capacity =
            driverData.operational_state.default_selected_car.max_passengers;
          //...
          let refinedRequests = requestsData.filter((request) => {
            let tmpReg = new RegExp(request.ride_mode, "i");
            return tmpReg.test(clearancesString);
          });
          //Slice based on the max capacity
          refinedRequests = refinedRequests.slice(0, max_passengers_capacity);
          //PARSE THE FINAL REQUESTS
          new Promise((res) => {
            parseRequests_forDrivers_view(
              refinedRequests,
              collectionPassengers_profiles,
              driverData,
              res
            );
          }).then(
            (resultFinal) => {
              console.log("REFINED");
              console.log(resultFinal);
              resolve(resultFinal);
            },
            (error) => {
              console.log(error);
              resolve(false);
            }
          );
        } //No requests
        else {
          resolve({ response: "no_requests" });
        }
      });
  } //Unknown scenario
  else {
    resolve(false);
  }
}

/**
 * @func parseRequests_forDrivers_view
 * Responsible for parsing the raw requests data into an app friendly format, limiting the data
 * to ONLY the needed ones.
 * @param requestsArray: the array containing all the found requests.
 * @param collectionPassengers_profiles: the list of all the passengers profiles.
 * @param driverData: the full drivers profile data
 * @param resolve
 * CACHE EVERY SINGLE PROCCESSED REQUESTS: redisKey: request_fp+cached_tempo-parsed-request
 */
function parseRequests_forDrivers_view(
  requestsArray,
  collectionPassengers_profiles,
  driverData,
  resolve
) {
  let batchRequestProcessing = requestsArray.map((request) => {
    return new Promise((res) => {
      //Build the redis key unique template
      let redisKey = request.request_fp + "cached_tempo-parsed-request";
      //CHECK for any previous parsing
      redisGet(redisKey).then(
        (resp) => {
          if (resp !== null) {
            console.log("Found single request cached stored!");
            //Has a previous record
            try {
              resp = JSON.parse(resp);
              //Make a background update request
              new Promise((resFresh) => {
                execDriver_requests_parsing(
                  request,
                  collectionPassengers_profiles,
                  driverData,
                  redisKey,
                  resFresh
                );
              }).then(
                () => {},
                () => {}
              );
              //...
              //Quickly return the cached result
              res(resp);
            } catch (error) {
              console.log(error);
              //Error make a fresh request
              new Promise((resFresh) => {
                execDriver_requests_parsing(
                  request,
                  collectionPassengers_profiles,
                  driverData,
                  redisKey,
                  resFresh
                );
              }).then(
                (resultParsed) => {
                  res(resultParsed);
                },
                (error) => {
                  console.log(error);
                  res(false);
                }
              );
            }
          } //No previous record - make a fresh request
          else {
            new Promise((resFresh) => {
              execDriver_requests_parsing(
                request,
                collectionPassengers_profiles,
                driverData,
                redisKey,
                resFresh
              );
            }).then(
              (resultParsed) => {
                res(resultParsed);
              },
              (error) => {
                console.log(error);
                res(false);
              }
            );
          }
        },
        (error) => {
          console.log(error);
          //Error make a fresh request
          new Promise((resFresh) => {
            execDriver_requests_parsing(
              request,
              collectionPassengers_profiles,
              driverData,
              redisKey,
              resFresh
            );
          }).then(
            (resultParsed) => {
              res(resultParsed);
            },
            (error) => {
              console.log(error);
              res(false);
            }
          );
        }
      );
    });
  });
  //...
  Promise.all(batchRequestProcessing)
    .then(
      (batchRequestsResults) => {
        //Remove any false values
        batchRequestsResults = batchRequestsResults.filter(
          (request) => request !== false
        );
        //DONE WITH BATCH REQUESTS
        resolve(batchRequestsResults);
      },
      (error) => {
        console.log(error);
        resolve(false);
      }
    )
    .catch((error) => {
      console.log(error);
      resolve(false);
    });
}

/**
 * @func execDriver_requests_parsing
 * Responsible for executing the parsing for the individual requests fetched by the drivers
 * @param request: raw single request straight from Mongo
 * @param collectionPassengers_profiles: the list of all the passengers profiles.
 * @param driverData: the full drivers profile data
 * @param redisKey: the redis key to cache the result after computing
 * @param resolve
 */
function execDriver_requests_parsing(
  request,
  collectionPassengers_profiles,
  driverData,
  redisKey,
  resolve
) {
  let res = resolve;
  let parsedRequestsArray = {
    request_fp: null,
    request_type: null, //! RIDE, DELIVERY OR SCHEDULED
    passenger_infos: {
      name: null,
      phone_number: null,
    },
    eta_to_passenger_infos: {
      eta: null,
      distance: null,
    },
    ride_basic_infos: {
      payment_method: null,
      wished_pickup_time: null, //Very important for scheduled requests
      date_state_wishedPickup_time: null, //To indicate "Today" or "Tomorrow" for the pickup time.
      fare_amount: null,
      passengers_number: null,
      connect_type: null,
      isAccepted: null,
      inRideToDestination: null,
      isRideCompleted_driverSide: null,
      ride_mode: null, //ride or delivery
      request_type: null, //immediate or scheduled
      pickup_note: null, //If not set - null
      rider_infos: null,
      receiver_infos: null, //Receiver's infos
    },
    origin_destination_infos: {
      pickup_infos: {
        location_name: null,
        street_name: null,
        suburb: null,
        coordinates: null,
      },
      eta_to_destination_infos: {
        eta: null,
        distance: null,
      },
      destination_infos: null, //Array of n destination(s) - location_name, street_name, suburb, passenger_id
    },
  };
  //...
  //Start the individual parsing
  //1. Add the passenger infos
  collectionPassengers_profiles
    .find({ user_fingerprint: { $regex: request.client_id, $options: "i" } })
    .toArray(function (err, passengerData) {
      if (err) {
        res(false);
      }
      if (passengerData !== undefined && passengerData.length > 0) {
        //Found some data
        //...
        passengerData = passengerData[0];
        //...
        parsedRequestsArray.passenger_infos.name = request.ride_state_vars
          .isAccepted
          ? passengerData.name
          : null;
        parsedRequestsArray.passenger_infos.phone_number = request
          .ride_state_vars.isAccepted
          ? passengerData.phone_number
          : null;
        //2. Add the basic trip infos
        parsedRequestsArray.ride_basic_infos.payment_method =
          request.payment_method;
        parsedRequestsArray.ride_basic_infos.wished_pickup_time =
          request.wished_pickup_time;
        //? Check if Today or Tomorrow Only for scheduled requests
        if (/scheduled/i.test(request.request_type)) {
          //Scheduled request
          parsedRequestsArray.ride_basic_infos.date_state_wishedPickup_time =
            new Date(request.wished_pickup_time).getDate() ===
            new Date(chaineDateUTC).getDate()
              ? "Today"
              : new Date(request.wished_pickup_time).getDate() >
                new Date(chaineDateUTC).getDate()
              ? "Tomorrow"
              : "Yesterday";
        } //Immediate request
        else {
          parsedRequestsArray.ride_basic_infos.date_state_wishedPickup_time = null;
        }
        //?---
        parsedRequestsArray.ride_basic_infos.fare_amount = parseFloat(
          request.fare
        );
        parsedRequestsArray.ride_basic_infos.passengers_number = parseInt(
          request.passengers_number
        );
        parsedRequestsArray.ride_basic_infos.request_type =
          request.request_type;
        parsedRequestsArray.ride_basic_infos.ride_mode = request.ride_mode;
        parsedRequestsArray.ride_basic_infos.connect_type =
          request.connect_type;
        parsedRequestsArray.ride_basic_infos.isAccepted =
          request.ride_state_vars.isAccepted;
        parsedRequestsArray.ride_basic_infos.inRideToDestination =
          request.ride_state_vars.inRideToDestination;
        parsedRequestsArray.ride_basic_infos.isRideCompleted_driverSide =
          request.ride_state_vars.isRideCompleted_driverSide;
        //...
        parsedRequestsArray.ride_basic_infos.rider_infos = request.rider_infos;
        parsedRequestsArray.ride_basic_infos.pickup_note =
          /false/i.test(request.pickup_location_infos.pickup_note) ||
          request.pickup_location_infos.pickup_note === "false" ||
          request.pickup_location_infos.pickup_note === false
            ? null
            : request.pickup_location_infos.pickup_note;
        //...
        parsedRequestsArray.ride_basic_infos.receiver_infos =
          request.delivery_infos;
        //3. Compute the ETA to passenger
        new Promise((res0) => {
          getRouteInfosDestination(
            {
              destination: {
                latitude: parseFloat(
                  driverData.operational_state.last_location.coordinates
                    .latitude
                ),
                longitude: parseFloat(
                  driverData.operational_state.last_location.coordinates
                    .longitude
                ),
              },
              passenger: {
                latitude: parseFloat(
                  request.pickup_location_infos.coordinates.latitude
                ),
                longitude: parseFloat(
                  request.pickup_location_infos.coordinates.longitude
                ),
              },
            },
            res0,
            true,
            request.request_fp + "-cached-etaToPassenger-requests"
          );
        })
          .then(
            (resultEtaToPassenger) => {
              if (resultEtaToPassenger !== false) {
                //Save the eta and distancee
                parsedRequestsArray.eta_to_passenger_infos.eta =
                  resultEtaToPassenger.eta;
                parsedRequestsArray.eta_to_passenger_infos.distance =
                  resultEtaToPassenger.distance;
                //4. Add the destination informations
                parsedRequestsArray.origin_destination_infos.pickup_infos.location_name =
                  request.pickup_location_infos.location_name !== undefined &&
                  request.pickup_location_infos.location_name !== false
                    ? request.pickup_location_infos.location_name
                    : request.pickup_location_infos.street_name;
                parsedRequestsArray.origin_destination_infos.pickup_infos.street_name =
                  request.pickup_location_infos.street_name;
                parsedRequestsArray.origin_destination_infos.pickup_infos.suburb =
                  request.pickup_location_infos.suburb;
                parsedRequestsArray.origin_destination_infos.pickup_infos.coordinates =
                  request.pickup_location_infos.coordinates;

                //ADD THE REQUEST TYPE
                parsedRequestsArray.request_type = /(now|immediate)/i.test(
                  request.request_type
                )
                  ? request.ride_mode
                  : "scheduled";

                //Compute the ETA to destination details
                new Promise((res1) => {
                  getRouteInfosDestination(
                    {
                      destination: {
                        latitude: parseFloat(
                          request.destinationData[0].coordinates.longitude
                        ),
                        longitude: parseFloat(
                          request.destinationData[0].coordinates.latitude
                        ),
                      },
                      passenger: {
                        latitude: parseFloat(
                          request.pickup_location_infos.coordinates.latitude
                        ),
                        longitude: parseFloat(
                          request.pickup_location_infos.coordinates.longitude
                        ),
                      },
                    },
                    res1,
                    true,
                    request.request_fp + "-cached-etaToDestination-requests"
                  );
                }).then(
                  (resultETAToDestination) => {
                    if (resultETAToDestination !== false) {
                      //Save the ETA to destination data
                      parsedRequestsArray.origin_destination_infos.eta_to_destination_infos.eta =
                        resultETAToDestination.eta;
                      parsedRequestsArray.origin_destination_infos.eta_to_destination_infos.distance =
                        resultETAToDestination.distance;
                      //4. Save the destination data
                      parsedRequestsArray.origin_destination_infos.destination_infos =
                        request.destinationData;
                      //Add the request fingerprint
                      parsedRequestsArray.request_fp = request.request_fp;
                      //DONE
                      //CACHE
                      new Promise((resCache) => {
                        client.set(
                          redisKey,
                          JSON.stringify(parsedRequestsArray)
                        );
                        resCache(true);
                      }).then(
                        () => {
                          console.log("Single processing cached!");
                        },
                        () => {}
                      );
                      //Return the answer
                      res(parsedRequestsArray);
                    } //Error
                    else {
                      res(false);
                    }
                  },
                  (error) => {
                    console.log(error);
                    res(false);
                  }
                );
              } //EError
              else {
                res(false);
              }
            },
            (error) => {
              console.log(error);
              res(false);
            }
          )
          .catch((error) => {
            console.log(error);
            resolve(false);
          });
      } //No data found - strange
      else {
        resolve(false);
      }
    });
}

/**
 * @func getRideCachedData_andComputeRoute()
 * Responsible for checking if there are any cached requests for a rider, or get from mongo and launch the computation of the trip details
 * and cache them.
 */

function getUserRideCachedData_andComputeRoute(
  collectionRidesDeliveries_data,
  user_fingerprint,
  user_nature,
  respUser,
  resolve
) {
  //Check if there are any cached user data
  //1. Pre compute and cache next record for later use
  new Promise((reslv) => {
    getMongoRecordTrip_cacheLater(
      collectionRidesDeliveries_data,
      user_fingerprint,
      user_nature,
      respUser.request_fp,
      reslv
    );
  }).then(
    (reslt) => {
      //console.log("precomputed for later use done.");
    },
    (error) => {
      //console.log(error);
    }
  );
  //........Return cached data
  //console.log("found cached user trip infos");
  //Compute route via compute skeleton
  computeRouteDetails_skeleton([respUser], resolve);
}

/**
 * @func getMongoRecordTrip_cacheLater()
 * @param collectionDrivers_profiles: list of all the drivers
 * Responsible for getting user record from mongodb, compute route infos, cache it (and cache the user's trip infos for later use).
 * CAN BE USED FOR RIDERS AND DRIVERS
 */
function getMongoRecordTrip_cacheLater(
  collectionRidesDeliveries_data,
  collectionDrivers_profiles,
  user_fingerprint,
  user_nature,
  request_fp,
  resolve
) {
  //Check if there are any requests in MongoDB
  let queryFilter = {
    client_id: user_fingerprint,
    request_fp: request_fp,
  };
  collectionRidesDeliveries_data
    .find(queryFilter)
    .toArray(function (err, result) {
      if (err) {
        resolve(false);
        throw err;
      }
      //Compute route via compute skeleton
      computeRouteDetails_skeleton(result, collectionDrivers_profiles, resolve);
    });
}
/**
 * @func computeRouteDetails_skeleton
 * Compute route details template.
 * @param collectionDrivers_profiles: list of all the drivers
 * MUST convert input into a unique indexed array, eg: [result]
 * CAN BE USED FOR RIDERS AND DRIVERS
 */
function computeRouteDetails_skeleton(
  result,
  collectionDrivers_profiles,
  resolve
) {
  if (result.length > 0 && result[0].request_fp !== undefined) {
    //There is a ride
    let rideHistory = result[0];
    let riderCoords = rideHistory.pickup_location_infos.coordinates;
    if (rideHistory.ride_state_vars.isAccepted) {
      console.log("request accepted");
      //Get all the driver's informations
      collectionDrivers_profiles
        .find({ driver_fingerprint: rideHistory.taxi_id })
        .toArray(function (err, driverProfile) {
          if (err) {
            console.log(err);
            resolve(false); //An error happened
          }

          if (driverProfile.length > 0) {
            //Found the driver's profile
            driverProfile = driverProfile[0];
            //...EXPLORE RIDE SCENARIOS
            //3 Scenarios:
            //- In route to pickup
            //- In route to drop off
            //- Trip over, confirm drop off rider
            if (
              rideHistory.ride_state_vars.inRideToDestination === false &&
              rideHistory.ride_state_vars.isRideCompleted_driverSide === false
            ) {
              console.log("IN ROUTE TO PICKUP");
              //In route to pickup
              //console.log("In  route to pickup");
              let requestStatusMain = "inRouteToPickup";
              //Get driver's coordinates
              //Get driver coords from cache, it non existant, get from mongo
              redisGet(rideHistory.taxi_id).then(
                (resp) => {
                  if (resp !== null) {
                    console.log(rideHistory.taxi_id);
                    //Check for any trip record related to the route infos in the cache
                    //KEY: request_fp
                    redisGet(rideHistory.request_fp).then(
                      (resp0) => {
                        if (resp0 !== null) {
                          try {
                            //Compute next route update ---------------------------------------------------
                            new Promise((reslv) => {
                              computeAndCacheRouteDestination(
                                resp,
                                rideHistory,
                                driverProfile,
                                riderCoords,
                                requestStatusMain,
                                reslv
                              );
                            }).then(
                              () => {},
                              () => {}
                            );
                            //............Return cached
                            let tripData = JSON.parse(resp0);
                            //Found a precomputed record
                            //console.log("Trip data cached found!");
                            resolve(tripData);
                          } catch (error) {
                            //console.log(error);
                            resolve(false);
                          }
                        } //no record create a new one
                        else {
                          //Compute next route update ---------------------------------------------------
                          new Promise((reslv) => {
                            computeAndCacheRouteDestination(
                              resp,
                              rideHistory,
                              driverProfile,
                              riderCoords,
                              requestStatusMain,
                              reslv
                            );
                          }).then(
                            () => {
                              //Get route infos from cache.
                              redisGet(rideHistory.request_fp).then(
                                (result) => {
                                  resolve(result);
                                },
                                (error) => {
                                  //console.log(error);
                                  resolve(false);
                                }
                              );
                            },
                            (error) => {
                              resolve(false);
                            }
                          );
                        }
                      },
                      (err0) => {
                        //console.log(err0);
                        //Compute next route update ---------------------------------------------------
                        new Promise((reslv) => {
                          computeAndCacheRouteDestination(
                            resp,
                            rideHistory,
                            driverProfile,
                            riderCoords,
                            requestStatusMain,
                            reslv
                          );
                        }).then(
                          () => {
                            //Get route infos from cache.
                            redisGet(rideHistory.request_fp).then(
                              (result) => {
                                resolve(result);
                              },
                              (error) => {
                                //console.log(error);
                                resolve(false);
                              }
                            );
                          },
                          (error) => {
                            resolve(false);
                          }
                        );
                      }
                    );
                  } else {
                    console.log("Skip cache");
                    //GET THE DRIVER'S LOCATION FROM MONGO DB
                    //! auto cache the driver's location - Major performance update!
                    client.set(
                      rideHistory.taxi_id,
                      JSON.stringify(
                        driverProfile.operational_state.last_location
                          .coordinates
                      )
                    );
                    //Compute next route update ---------------------------------------------------
                    new Promise((reslv) => {
                      computeAndCacheRouteDestination(
                        JSON.stringify(
                          driverProfile.operational_state.last_location
                            .coordinates
                        ),
                        rideHistory,
                        driverProfile,
                        riderCoords,
                        requestStatusMain,
                        reslv
                      );
                    }).then(
                      () => {
                        //Get route infos from cache.
                        redisGet(rideHistory.request_fp).then(
                          (result) => {
                            resolve(JSON.parse(result));
                          },
                          (error) => {
                            //console.log(error);
                            resolve(false);
                          }
                        );
                      },
                      (error) => {
                        resolve(false);
                      }
                    );
                  }
                },
                (error) => {
                  //console.log(error);
                  resolve(false);
                }
              );
            } else if (
              rideHistory.ride_state_vars.inRideToDestination === true &&
              rideHistory.ride_state_vars.isRideCompleted_driverSide === false
            ) {
              //In route to drop off
              //console.log("In route to drop off");
              let requestStatusMain = "inRouteToDestination";
              //Get driver coords from cache, it non existant, get from mongo
              redisGet(rideHistory.taxi_id).then(
                (resp) => {
                  if (resp !== null) {
                    //Check for any trip record related to the route infos in the cache
                    //KEY: request_fp
                    redisGet(rideHistory.request_fp).then(
                      (resp0) => {
                        if (resp0 !== null) {
                          try {
                            //Compute next route update ---------------------------------------------------
                            new Promise((reslv) => {
                              computeAndCacheRouteDestination(
                                resp,
                                rideHistory,
                                driverProfile,
                                riderCoords,
                                requestStatusMain,
                                reslv
                              );
                            }).then(
                              () => {
                                console.log("Updated");
                              },
                              () => {}
                            );
                            //............Return cached
                            let tripData = JSON.parse(resp0);
                            //Found a precomputed record
                            console.log("Trip data cached found!");
                            resolve(tripData);
                          } catch (error) {
                            //console.log(error);
                            //Compute next route update ---------------------------------------------------
                            new Promise((reslv) => {
                              computeAndCacheRouteDestination(
                                resp,
                                rideHistory,
                                driverProfile,
                                riderCoords,
                                requestStatusMain,
                                reslv
                              );
                            }).then(
                              () => {
                                //Get route infos from cache.
                                redisGet(rideHistory.request_fp).then(
                                  (result) => {
                                    resolve(result);
                                  },
                                  (error) => {
                                    //console.log(error);
                                    resolve(false);
                                  }
                                );
                              },
                              (error) => {
                                resolve(false);
                              }
                            );
                          }
                        } //no record create a new one
                        else {
                          //Compute next route update ---------------------------------------------------
                          new Promise((reslv) => {
                            computeAndCacheRouteDestination(
                              resp,
                              rideHistory,
                              driverProfile,
                              riderCoords,
                              requestStatusMain,
                              reslv
                            );
                          }).then(
                            () => {
                              //Get route infos from cache.
                              redisGet(rideHistory.request_fp).then(
                                (result) => {
                                  resolve(result);
                                },
                                (error) => {
                                  //console.log(error);
                                  resolve(false);
                                }
                              );
                            },
                            (error) => {
                              resolve(false);
                            }
                          );
                        }
                      },
                      (err0) => {
                        //console.log(err0);
                        //Compute next route update ---------------------------------------------------
                        new Promise((reslv) => {
                          computeAndCacheRouteDestination(
                            resp,
                            rideHistory,
                            driverProfile,
                            riderCoords,
                            requestStatusMain,
                            reslv
                          );
                        }).then(
                          () => {
                            //Get route infos from cache.
                            redisGet(rideHistory.request_fp).then(
                              (result) => {
                                resolve(result);
                              },
                              (error) => {
                                //console.log(error);
                                resolve(false);
                              }
                            );
                          },
                          (error) => {
                            resolve(false);
                          }
                        );
                      }
                    );
                  } else {
                    //GET THE DRIVER'S LOCATION FROM MONGO DB
                    //! auto cache the driver's location - Major performance update!
                    client.set(
                      rideHistory.taxi_id,
                      JSON.stringify(
                        driverProfile.operational_state.last_location
                          .coordinates
                      )
                    );
                    //Compute next route update ---------------------------------------------------
                    new Promise((reslv) => {
                      computeAndCacheRouteDestination(
                        JSON.stringify(
                          driverProfile.operational_state.last_location
                            .coordinates
                        ),
                        rideHistory,
                        driverProfile,
                        riderCoords,
                        requestStatusMain,
                        reslv
                      );
                    }).then(
                      () => {
                        //Get route infos from cache.
                        redisGet(rideHistory.request_fp).then(
                          (result) => {
                            resolve(JSON.parse(result));
                          },
                          (error) => {
                            //console.log(error);
                            resolve(false);
                          }
                        );
                      },
                      (error) => {
                        resolve(false);
                      }
                    );
                  }
                },
                (error) => {
                  //console.log(error);
                  resolve(false);
                }
              );
            } else if (
              rideHistory.ride_state_vars.isRideCompleted_driverSide === true &&
              rideHistory.ride_state_vars.isRideCompleted_riderSide === false &&
              rideHistory.isArrivedToDestination === false
            ) {
              //Rider's confirmation for the drop off left
              //Gather basic ride infos (origin, destination, ride mode - RIDE/DELIVERY, date requested, request_fp) and basic driver infos(name, picture)
              //riderDropoffConfirmation_left
              let confirmation_request_schema = {
                request_status: "riderDropoffConfirmation_left",
                trip_details: {
                  pickup_name: null,
                  destination_name: null,
                  ride_mode: null, //Ride or delivery
                  date_requested: null, //dd/mm/yy, hh/mm/ss
                  request_fp: null,
                },
                driver_details: {
                  name: null,
                  profile_picture: null,
                },
              };
              console.log("Riders confirmation of drop off");

              //1. Resolve pickup location name
              confirmation_request_schema.trip_details.pickup_name =
                rideHistory.pickup_location_infos.location_name !== false &&
                rideHistory.pickup_location_infos.location_name !== undefined
                  ? rideHistory.pickup_location_infos.location_name
                  : rideHistory.pickup_location_infos.street_name !== false &&
                    rideHistory.pickup_location_infos.street_name !== undefined
                  ? rideHistory.pickup_location_infos.street_name
                  : rideHistory.pickup_location_infos.suburb !== false &&
                    rideHistory.pickup_location_infos.suburb !== undefined
                  ? rideHistory.pickup_location_infos.suburb
                  : "unclear location.";
              //2. Resolve the destinations
              rideHistory.destinationData.map((location) => {
                if (
                  confirmation_request_schema.trip_details.destination_name ===
                  null
                ) {
                  //Still empty
                  confirmation_request_schema.trip_details.destination_name =
                    location.location_name !== false &&
                    location.location_name !== undefined
                      ? location.location_name
                      : location.suburb !== false &&
                        location.suburb !== undefined
                      ? location.suburb
                      : "Click for more";
                } //Add
                else {
                  confirmation_request_schema.trip_details.destination_name +=
                    ", " +
                    (location.location_name !== false &&
                    location.location_name !== undefined
                      ? location.location_name
                      : location.suburb !== false &&
                        location.suburb !== undefined
                      ? location.suburb
                      : "Click for more");
                }
              });
              //3. Add ride mode
              confirmation_request_schema.trip_details.ride_mode = rideHistory.ride_mode.toUpperCase();
              //4. Add the date requested
              //Reformat the data
              let dateRequest = new Date(rideHistory.date_requested);
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
              confirmation_request_schema.trip_details.date_requested = dateRequest;
              //5. Add the request_fp - Very important
              confirmation_request_schema.trip_details.request_fp =
                rideHistory.request_fp;
              //6. Add the driver's name and profile picture
              confirmation_request_schema.driver_details.name =
                driverProfile.name;
              confirmation_request_schema.driver_details.profile_picture = `${process.env.AWS_S3_DRIVERS_PROFILE_PICTURES_PATH}/${driverProfile.identification_data.profile_picture}`;

              //Done
              resolve(confirmation_request_schema);
            } //No action needed
            else {
              resolve(true);
            }
          } //No driver's profile found - error - very strange isn't it
          else {
            resolve(false);
          }
        });
    } //Request pending
    else {
      //console.log("request pending...");
      //!!! ONLY SUPPORT ONE DESTINATION TRACKING.
      /*let bundle = {
        driver: undefined,
        passenger_origin: {
          latitude: rideHistory.rider_pickupLocation.point.latitude,
          longitude: rideHistory.rider_pickupLocation.point.longitude,
        },
        passenger_destination: {
          latitude: rideHistory.rider_destination.destination1.point.latitude,
          longitude: rideHistory.rider_destination.destination1.point.longitude,
        },
      };

      new Promise((reslv) => {
        getRouteInfos(bundle, reslv);
      }).then(
        (result) => {
          //Add request status variable - pending
          result["request_status"] = "pending";
          resolve(result);
        },
        (error) => {
          //console.log(error);
          resolve(false);
        }
      );*/
      //Cache response
      new Promise((res) => {
        //Get previous record
        redisGet(rideHistory.request_fp).then(
          (reslt) => {
            if (reslt !== null) {
              try {
                reslt = JSON.parse(reslt);
                //Update old record
                reslt.rides_history = {
                  pickupLocation_name:
                    rideHistory.pickup_location_infos.location_name,
                  pickupLocation_point: [
                    rideHistory.pickup_location_infos.coordinates.longitude,
                    rideHistory.pickup_location_infos.coordinates.latitude,
                  ],
                  request_status: "pending",
                };
                //..
                client.set(
                  rideHistory.client_id,
                  JSON.stringify(reslt),
                  redis.print
                );
                res(true);
              } catch (error) {
                //Ignore
                res(false);
              }
            } //Create fresh record
            else {
              client.set(
                rideHistory.request_fp,
                JSON.stringify({
                  rides_history: {
                    pickupLocation_name:
                      rideHistory.pickup_location_infos.location_name,
                    pickupLocation_point: [
                      rideHistory.pickup_location_infos.coordinates.longitude,
                      rideHistory.pickup_location_infos.coordinates.latitude,
                    ],
                    request_status: "pending",
                  },
                }),
                redis.print
              );
              res(true);
            }
          },
          (error) => {
            //Ignore
            res(false);
          }
        );
      }).then(
        () => {},
        () => {}
      );
      //Add request status variable - pending
      resolve({
        pickupLocation_name: rideHistory.pickup_location_infos.location_name,
        pickupLocation_point: [
          rideHistory.pickup_location_infos.coordinates.longitude,
          rideHistory.pickup_location_infos.coordinates.latitude,
        ],
        request_fp: rideHistory.request_fp,
        request_status: "pending",
      });
    }
  } //No ride present
  else {
    console.log("No ride in progress");
    resolve(true);
  }
}

/**
 * ACCEPTED RIDES ONLY
 * @func computeAndCacheRouteDestination()
 * @param rideHistory: contains the infos about the passenger's ride history
 * @param driverProfile: the profile information of the driver who accepted the request.
 * @param driverInfos: contains the infos of the associated driver from cache or mongo IN TEXT FROM - Use JSON.parse to make a useful object.
 * @param resolve: resover for the promise.
 * @param request_status: responsible for specifying if the computation is done for in route to pickup, in route to drop off or any other case.
 * Responsible for finding all the trip information for a sepcific ride and cache it for later and efficient use.
 * UPDATE DRIVER AND PASSENGER CACHE RIDE HISTORY.
 * Promisify!
 */
function computeAndCacheRouteDestination(
  driverInfos,
  rideHistory,
  driverProfile = false,
  riderCoords = false,
  request_status,
  resolve
) {
  //Compute next route update ---------------------------------------------------
  let resp = JSON.parse(driverInfos); //The coordinates
  let bundle = {};
  let redisKey = rideHistory.client_id + "-" + rideHistory.taxi_id;
  if (request_status === "inRouteToPickup") {
    //For to pickup only
    bundle = {
      driver: {
        latitude: resp.latitude,
        longitude: resp.longitude,
      },
      passenger: {
        latitude: riderCoords.latitude,
        longitude: riderCoords.longitude,
      },
      redisKey: redisKey,
      //Take the passenger's 1 destination as reference
      //destination: rideHistory.destinationData[0].coordinates,
    };
  } else if (request_status === "inRouteToDestination") {
    console.log("in route to destination");
    //For to drop off only
    bundle = {
      passenger_origin: {
        latitude: riderCoords.latitude,
        longitude: riderCoords.longitude,
      },
      redisKey: redisKey,
      passenger_destination: {
        latitude: rideHistory.destinationData[0].coordinates.longitude,
        longitude: rideHistory.destinationData[0].coordinates.latitude,
      },
    };
  }

  new Promise((reslv) => {
    getRouteInfos(bundle, reslv);
  }).then(
    (result) => {
      //Do the preliminary caching
      new Promise((resolvePreli) => {
        //Update driver old trip cached ride history
        redisGet(resp.user_fingerprint).then(
          (res) => {
            if (res !== null) {
              try {
                let prevDriverCache = JSON.parse(res);
                prevDriverCache.rides_history = rideHistory;
                client.set(
                  resp.user_fingerprint,
                  JSON.stringify(prevDriverCache),
                  redis.print
                );
                //Update rider old trip cached ride history
                redisGet(rideHistory.client_id).then(
                  (res1) => {
                    if (res !== null) {
                      try {
                        let prevRiderCache = JSON.parse(res1);
                        prevRiderCache.rides_history = rideHistory;
                        client.set(
                          rideHistory.client_id,
                          JSON.stringify(prevRiderCache),
                          redis.print
                        );
                        resolvePreli(true);
                      } catch (error) {
                        resolvePreli(true);
                      }
                    } else {
                      resolvePreli(true);
                    }
                  },
                  () => {
                    resolvePreli(true);
                  }
                );
              } catch (error) {
                resolvePreli(true);
              }
            } else {
              resolvePreli(true);
            }
          },
          () => {
            resolvePreli(true);
          }
        );
        //--------
      }).then(
        () => {},
        () => {}
      );
      //console.log("HEEEEEEEE->", result);
      //console.log(rideHistory.destinationData);
      //Add request status variable - inRouteToPickup, inRouteToDestination
      result["request_status"] = request_status;
      let additionalInfos = {
        ETA_toDestination: null,
        request_status: null, //inRouteToPickup, inRouteToDestination, pending
        driverDetails: {
          name: null,
          profile_picture: null,
          global_rating: null,
          phone_number: null,
        },
        carDetails: {
          taxi_number: null,
          car_brand: null,
          car_image: null,
          plate_number: null,
          verification_status: "Verified",
        },
        basicTripDetails: {
          pickup_name: null,
          destination_name: null, //comma concatenated list of destinations
          payment_method: null, //CASH or WALLET
          fare_amount: null,
          passengers_number: null,
          ride_mode: null, //Ride or delivery
          ride_simplified_id: null, //Very useful for sharing/tracking the trip infos
          request_fp: null, //! VERY IMPORTANT
        },
      }; //Will contain all the additional informations needed
      //Add the driver's basic information (name, profile picture, taxi number-if any, car brand, car image, general rating, plate number, phone number)
      additionalInfos.driverDetails.name = driverProfile.name;
      additionalInfos.driverDetails.profile_picture = `${process.env.AWS_S3_DRIVERS_PROFILE_PICTURES_PATH}/${driverProfile.identification_data.profile_picture}`;
      additionalInfos.driverDetails.global_rating =
        driverProfile.operational_state.global_rating !== undefined &&
        driverProfile.operational_state.global_rating !== null
          ? driverProfile.operational_state.global_rating
          : 4.9;
      additionalInfos.driverDetails.phone_number = driverProfile.phone_number;
      //Add the current car details
      //! Get the correct car information
      let currentVehicle = null;
      driverProfile.cars_data.map((car) => {
        if (
          car.car_fingerprint ===
          driverProfile.operational_state.default_selected_car.car_fingerprint
        ) {
          //Found the car
          currentVehicle = car;
        }
      });
      //! Get the first car registered if null was found
      currentVehicle =
        currentVehicle !== null && currentVehicle !== undefined
          ? currentVehicle
          : driverProfile.cars_data[0];
      //!------
      //Complete the car's infos
      additionalInfos.carDetails.taxi_number = currentVehicle.taxi_number;
      additionalInfos.carDetails.car_brand = currentVehicle.car_brand;
      additionalInfos.carDetails.car_image = currentVehicle.taxi_picture;
      additionalInfos.carDetails.plate_number = currentVehicle.plate_number;
      //Add pickup name and destination name
      additionalInfos.basicTripDetails.pickup_name =
        rideHistory.pickup_location_infos.location_name !== false &&
        rideHistory.pickup_location_infos.location_name !== undefined
          ? rideHistory.pickup_location_infos.location_name
          : rideHistory.pickup_location_infos.street_name !== false &&
            rideHistory.pickup_location_infos.street_name !== undefined
          ? rideHistory.pickup_location_infos.street_name
          : rideHistory.pickup_location_infos.suburb !== false &&
            rideHistory.pickup_location_infos.suburb !== undefined
          ? rideHistory.pickup_location_infos.suburb
          : "unclear location.";
      //Add ddestination name(s)
      rideHistory.destinationData.map((location) => {
        if (additionalInfos.basicTripDetails.destination_name === null) {
          //Still empty
          additionalInfos.basicTripDetails.destination_name =
            location.location_name !== false &&
            location.location_name !== undefined
              ? location.location_name
              : location.suburb !== false && location.suburb !== undefined
              ? location.suburb
              : "Click for more";
        } //Add
        else {
          additionalInfos.basicTripDetails.destination_name +=
            ", " +
            (location.location_name !== false &&
            location.location_name !== undefined
              ? location.location_name
              : location.suburb !== false && location.suburb !== undefined
              ? location.suburb
              : "Click for more");
        }
      });
      //Add payment method
      additionalInfos.basicTripDetails.payment_method = rideHistory.payment_method.toUpperCase();
      //Addd fare amount
      additionalInfos.basicTripDetails.fare_amount = rideHistory.fare;
      //Add the number of passengers
      additionalInfos.basicTripDetails.passengers_number =
        rideHistory.passengers_number;
      //Add the ride mode
      additionalInfos.basicTripDetails.ride_mode = rideHistory.ride_mode.toUpperCase();
      //Add the simplified id
      additionalInfos.basicTripDetails.ride_simplified_id =
        rideHistory.trip_simplified_id;
      //! Add the ride fingerprint
      additionalInfos.basicTripDetails.request_fp = rideHistory.request_fp;

      //Get the estimated time TO the destination (from the current's user position)
      new Promise((res4) => {
        let url =
          process.env.LOCAL_URL +
          ":" +
          process.env.MAP_SERVICE_PORT +
          "/getRouteToDestinationSnapshot?org_latitude=" +
          rideHistory.pickup_location_infos.coordinates.latitude +
          "&org_longitude=" +
          rideHistory.pickup_location_infos.coordinates.longitude +
          "&dest_latitude=" +
          rideHistory.destinationData[0].coordinates.longitude +
          "&dest_longitude=" +
          rideHistory.destinationData[0].coordinates.latitude +
          "&user_fingerprint=" +
          rideHistory.client_id;
        requestAPI(url, function (error, response, body) {
          if (error === null) {
            try {
              body = JSON.parse(body);
              res4(body.eta);
            } catch (error) {
              res4(false);
            }
          } else {
            res4(false);
          }
        });
      }).then(
        (estimated_travel_time) => {
          //Add the eta to destination
          additionalInfos.ETA_toDestination = estimated_travel_time;
          additionalInfos.request_status = request_status;
          result = { ...result, ...additionalInfos }; //Merge all the data
          //Cache-
          //Cache computed result
          new Promise((resPromiseresult) => {
            redisGet(rideHistory.request_fp).then(
              (cachedTripData) => {
                if (cachedTripData !== null) {
                  client.set(
                    rideHistory.request_fp,
                    JSON.stringify(result),
                    redis.print
                  );
                  resPromiseresult(true);
                } //Update cache anyways
                else {
                  //console.log("Update cache");
                  client.set(
                    rideHistory.request_fp,
                    JSON.stringify(result),
                    redis.print
                  );
                  resPromiseresult(true);
                }
              },
              (errorGet) => {
                //console.log("Update cache");
                client.set(
                  rideHistory.request_fp,
                  JSON.stringify(result),
                  redis.print
                );
                resPromiseresult(true);
              }
            );
          }).then(
            () => {},
            () => {}
          );
          //...
          ///DONE
          resolve(result);
        },
        (error) => {
          console.log(error);
          //If couldn't get the ETA to destination - just leave it as null
          result = { ...result, ...additionalInfos }; //Merge all the data
          //Cache-
          //Cache computed result
          new Promise((resPromiseresult) => {
            redisGet(rideHistory.request_fp).then(
              (cachedTripData) => {
                if (cachedTripData !== null) {
                  client.set(
                    rideHistory.request_fp,
                    JSON.stringify(result),
                    redis.print
                  );
                  resPromiseresult(true);
                } //Update cache anyways
                else {
                  //console.log("Update cache");
                  client.set(
                    rideHistory.request_fp,
                    JSON.stringify(result),
                    redis.print
                  );
                  resPromiseresult(true);
                }
              },
              (errorGet) => {
                //console.log("Update cache");
                client.set(
                  rideHistory.request_fp,
                  JSON.stringify(result),
                  redis.print
                );
                resPromiseresult(true);
              }
            );
          }).then(
            () => {},
            () => {}
          );
          //...
          ///DONE
          resolve(result);
        }
      );
    },
    (error) => {
      //console.log(error);
      resolve(false);
    }
  );
}

/**
 * @func updateRiderLocationInfosCache()
 * Responsible for updating the cache infos about the rider's trip location.
 * RIDERS/DRIVERS
 * @param req: contains all the user informations biased to the location aspect
 * @param resolve: resolver for promise
 * IMPORTANT
 */
function updateRiderLocationInfosCache(req, resolve) {
  resolveDate();
  req.date_logged = new Date(chaineDateUTC); //Attach date
  //Check if a previous entry alreay exist
  redisGet(req.user_fingerprint).then(
    (resp) => {
      if (resp !== null) {
        //Has already a cache entry
        try {
          let prevCache = JSON.parse(resp);
          //Update the previous cache
          prevCache.latitude = req.latitude;
          prevCache.longitude = req.longitude;
          prevCache.date_logged = req.date_logged; //Updated cache data
          client.set(
            req.user_fingerprint.trim(),
            JSON.stringify(prevCache),
            redis.print
          );
          resolve(true);
        } catch (error) {
          resolve(false);
        }
      } //No cache entry, create a new one
      else {
        client.set(req.user_fingerprint.trim(), JSON.stringify(req));
        resolve(true);
      }
    },
    (error) => {
      console.log(error);
      //Create or update the current cache entry
      client.set(req.user_fingerprint.trim(), JSON.stringify(req));
      resolve(true);
    }
  );
}

/**
 * @func reverseGeocodeUserLocation
 * @param resolve
 * @param req: user coordinates, and fingerprint
 * Responsible for finding out the current user (passenger, driver, etc) location details
 * REDIS propertiy
 * user_fingerprint+reverseGeocodeKey -> currentLocationInfos: {...}
 */
function reverseGeocodeUserLocation(resolve, req) {
  //Form the redis key
  let redisKey = req.user_fingerprint + "-reverseGeocodeKey";
  //Check if redis has some informations already
  redisGet(redisKey).then(
    (resp) => {
      if (resp !== null) {
        //Do a fresh request to update the cache
        //Make a new reseach
        new Promise((res) => {
          //console.log("Fresh geocpding launched");
          reverseGeocoderExec(res, req, JSON.parse(resp), redisKey);
        }).then(
          (result) => {},
          (error) => {}
        );

        //Has already a cache entry
        //Check if an old current location is present
        resp = JSON.parse(resp);
        if (resp.currentLocationInfos !== undefined) {
          //Make a rehydration request
          new Promise((res) => {
            reverseGeocoderExec(res, req, false, redisKey);
          }).then(
            (result) => {
              //Updating cache and replying to the main thread
              let currentLocationEntry = { currentLocationInfos: result };
              client.setex(
                redisKey,
                process.env.REDIS_EXPIRATION_5MIN,
                JSON.stringify(currentLocationEntry)
              );
            },
            (error) => {}
          );
          //Send
          resolve(resp.currentLocationInfos);
        } //No previously cached current location
        else {
          //Make a new reseach
          new Promise((res) => {
            reverseGeocoderExec(res, req, false, redisKey);
          }).then(
            (result) => {
              //Updating cache and replying to the main thread
              let currentLocationEntry = { currentLocationInfos: result };
              client.setex(
                redisKey,
                process.env.REDIS_EXPIRATION_5MIN,
                JSON.stringify(currentLocationEntry)
              );
              resolve(result);
            },
            (error) => {
              resolve(false);
            }
          );
        }
      } //No cache entry, create a new one
      else {
        //Make a new reseach
        new Promise((res) => {
          reverseGeocoderExec(res, req, false, redisKey);
        }).then(
          (result) => {
            //Updating cache and replying to the main thread
            let currentLocationEntry = { currentLocationInfos: result };
            client.setex(
              redisKey,
              process.env.REDIS_EXPIRATION_5MIN,
              JSON.stringify(currentLocationEntry)
            );
            resolve(result);
          },
          (error) => {
            resolve(false);
          }
        );
      }
    },
    (error) => {
      resolve(false);
    }
  );
}
/**
 * @func reverseGeocoderExec
 * @param updateCache: to known whether to update the cache or not if yes, will have the value of the hold cache.
 * @param req: the user basic data (fingerprint, etc)
 * @param redisKey: the redis key to cache the data to
 * Responsible for executing the geocoding new fresh requests
 */
function reverseGeocoderExec(resolve, req, updateCache = false, redisKey) {
  let url =
    process.env.URL_SEARCH_SERVICES +
    "reverse?lon=" +
    req.longitude +
    "&lat=" +
    req.latitude;
  requestAPI(url, function (error, response, body) {
    //body = JSON.parse(body);
    try {
      //console.log(body);
      body = JSON.parse(body);
      if (body != undefined) {
        if (body.features[0].properties != undefined) {
          if (body.features[0].properties.street != undefined) {
            if (updateCache !== false) {
              //Update cache
              updateCache.currentLocationInfos = body.features[0].properties;
              client.set(redisKey, JSON.stringify(updateCache));
            }
            //...
            resolve(body.features[0].properties);
          } else if (body.features[0].properties.name != undefined) {
            body.features[0].properties.street =
              body.features[0].properties.name;
            if (updateCache !== false) {
              //Update cache
              updateCache.currentLocationInfos = body.features[0].properties;
              client.set(redisKey, JSON.stringify(updateCache));
            }
            //...
            resolve(body.features[0].properties);
          } else {
            resolve(false);
          }
        } else {
          resolve(false);
        }
      } else {
        resolve(false);
      }
    } catch (error) {
      resolve(false);
    }
  });
}

/**
 * @func findoutPickupLocationNature
 * @param point: location point
 * @param user_fingerprint: fingerprint of the user. (INCLUDED IN POINT)
 * Responsible for check if the pickup location is a Taxi rank or private location (only these 2 for now)
 * Radius in meters - default: 2meters
 * Possible types
 * Airport
 * TaxiRank     //private location
 * PrivateLocation  //Private location
 */
function findoutPickupLocationNature(resolve, point) {
  let radius = 2; //meters
  let locationIdentity = { locationType: "PrivateLocation" }; //Default private location
  taxiRanksDb.map((location) => {
    let centerLat = parseFloat(location.central_coord.split(",")[0]);
    let centerLng = parseFloat(location.central_coord.split(",")[1]);
    //...
    const center = { lat: parseFloat(centerLat), lon: parseFloat(centerLng) };
    let checkPosition = geolocationUtlis.insideCircle(
      { lat: parseFloat(point.latitude), lon: parseFloat(point.longitude) },
      center,
      radius
    );
    if (checkPosition) {
      locationIdentity = location;
      //Can be changed here to include more places detections
      location = { locationType: "TaxiRank" }; //Set to taxi rank only
      //...
      resolve(location);
    } //Private location
    else {
      locationIdentity = { locationType: "PrivateLocation" };
    }
  });
  //Check for airport if Private location
  if (locationIdentity.locationType !== "TaxiRank") {
    //Check if it's an airport -reverse geocode and deduct from the name of the place
    new Promise((res) => {
      reverseGeocodeUserLocation(res, point);
    }).then(
      (result) => {
        if (result !== false) {
          if (result.name !== undefined) {
            if (/airport/i.test(result.name)) {
              //Airport detected
              locationIdentity = { locationType: "Airport", name: result.name };
              resolve(locationIdentity);
            } //Private location
            else {
              locationIdentity = { locationType: "PrivateLocation" };
              resolve(locationIdentity);
            }
          } else {
            locationIdentity = { locationType: "PrivateLocation" };
            resolve(locationIdentity);
          }
        } else {
          locationIdentity = { locationType: "PrivateLocation" };
          resolve(locationIdentity);
        }
      },
      (error) => {
        locationIdentity = { locationType: "PrivateLocation" };
        resolve(locationIdentity);
      }
    );
  } //Taxirank
  else {
    //...
    resolve(locationIdentity);
  }
}

/**
 * @func findDestinationPathPreview
 * @param resolve
 * @param pointData: origin and destination of the user selected from the app.
 * Responsible for getting the polyline and eta to destination based on the selected destination location.
 * REDIS
 * key: pathToDestinationPreview+user_fingerprint
 * value: [{...}, {...}]
 */
function findDestinationPathPreview(resolve, pointData) {
  console.log("entered");
  if (pointData.origin !== undefined && pointData.destination !== undefined) {
    //Create the redis key
    let redisKey =
      pointData.request_fp !== undefined && pointData.request_fp !== null
        ? "pathToDestinationPreview-" + pointData.request_fp
        : "pathToDestinationPreview-" + pointData.user_fingerprint;
    //Add redis key to pointData
    pointData.redisKey = null;
    pointData.redisKey = redisKey;
    //Check from redis first
    redisGet(redisKey).then(
      (resp) => {
        if (resp !== null) {
          //Found something cached
          try {
            //Check for needed record
            let neededRecord = false; //Will contain the needed record if exists or else false
            resp = JSON.parse(resp);
            resp.map((pathInfo) => {
              if (
                pathInfo.origin !== undefined &&
                pathInfo.origin.latitude === pointData.origin.latitude &&
                pathInfo.origin.longitude === pointData.origin.longitude &&
                pathInfo.destination.latitude ===
                  pointData.destination.latitude &&
                pathInfo.destination.longitude ===
                  pointData.destination.longitude
              ) {
                neededRecord = pathInfo;
              }
            });
            //...
            if (neededRecord !== false) {
              //Make a light request to update the eta
              new Promise((res) => {
                findRouteSnapshotExec(res, pointData);
              }).then(
                () => {},
                () => {}
              );
              //Found record - respond to the user
              resolve(neededRecord);
            } //Not record found - do fresh search
            else {
              new Promise((res) => {
                findRouteSnapshotExec(res, pointData);
              }).then(
                (result) => {
                  resolve(result);
                },
                (error) => {
                  resolve(false);
                }
              );
            }
          } catch (error) {
            //Error - do a fresh search
            new Promise((res) => {
              findRouteSnapshotExec(res, pointData);
            }).then(
              (result) => {
                resolve(result);
              },
              (error) => {
                resolve(false);
              }
            );
          }
        } //Nothing- do a fresh search
        else {
          new Promise((res) => {
            findRouteSnapshotExec(res, pointData);
          }).then(
            (result) => {
              resolve(result);
            },
            (error) => {
              resolve(false);
            }
          );
        }
      },
      (error) => {
        //Error - do a fresh search
        new Promise((res) => {
          findRouteSnapshotExec(res, pointData);
        }).then(
          (result) => {
            resolve(result);
          },
          (error) => {
            resolve(false);
          }
        );
      }
    );
  }
  //Invalid data
  else {
    resolve(false);
  }
}
/**
 * @func findRouteSnapshotExec
 * @param resolve
 * @param pointData: containing
 * Responsible to manage the requests of getting the polylines from the ROUTING engine
 * of TaxiConnect.
 */
function findRouteSnapshotExec(resolve, pointData) {
  let org_latitude = pointData.origin.latitude;
  let org_longitude = pointData.origin.longitude;
  let dest_latitude = pointData.destination.latitude;
  let dest_longitude = pointData.destination.longitude;
  //...
  new Promise((res) => {
    getRouteInfosDestination(
      {
        passenger: {
          latitude: org_latitude,
          longitude: org_longitude,
        },
        destination: {
          latitude: dest_latitude,
          longitude: dest_longitude,
        },
      },
      res
    );
  }).then(
    (result) => {
      result.origin = {
        latitude: org_latitude,
        longitude: org_longitude,
      };
      result.destination = {
        latitude: dest_latitude,
        longitude: dest_longitude,
      };
      //Save in cache
      new Promise((res) => {
        //Check if there was a previous redis record
        redisGet(pointData.redisKey).then(
          (resp) => {
            if (resp !== null) {
              //Contains something
              try {
                //Add new record to the array
                resp = JSON.parse(resp);
                resp.push(result);
                resp = [...new Set(resp.map(JSON.stringify))].map(JSON.parse);
                client.set(pointData.redisKey, JSON.stringify(resp));
                res(true);
              } catch (error) {
                //Create a fresh one
                client.set(pointData.redisKey, JSON.stringify([result]));
                res(false);
              }
            } //No records -create a fresh one
            else {
              client.set(pointData.redisKey, JSON.stringify([result]));
              res(true);
            }
          },
          (error) => {
            //create fresh record
            client.set(pointData.redisKey, JSON.stringify([result]));
            res(false);
          }
        );
      }).then(
        () => {},
        () => {}
      );
      //Respond already
      resolve(result);
    },
    (error) => {
      console.log(error);
      resolve(false);
    }
  );
}

/**
 * @func updateRelativeDistancesRiderDrivers
 * @param relativeHeader: includes the city, country, distance and ETA rider fingerprint and rider fingerprint
 * @param collectionRelativeDistances: realtive distances btw the riders and drivers
 * @param resolve
 * Responsible for updating the relative distances of a rider relative to the closeby drivers (city, country)
 */
function updateRelativeDistancesRiderDrivers(
  collectionRelativeDistances,
  relativeHeader,
  resolve
) {
  resolveDate();
  //Check if a previous mongo record already exists
  let queryChecker = {
    user_fingerprint: relativeHeader.user_fingerprint,
    driver_fingerprint: relativeHeader.driver_fingerprint,
  };
  collectionRelativeDistances
    .find(queryChecker)
    .toArray(function (err, record) {
      if (record.length === 0) {
        //Empty - create a new record
        let record = {
          user_fingerprint: relativeHeader.user_fingerprint,
          driver_fingerprint: relativeHeader.driver_fingerprint,
          driver_coordinates: relativeHeader.driver_coordinates,
          city: relativeHeader.city,
          country: relativeHeader.country,
          eta: relativeHeader.eta,
          distance: relativeHeader.distance,
          date_updated: new Date(chaineDateUTC),
        };
        //...
        collectionRelativeDistances.insertOne(record, function (err, res) {
          console.log("New relative distance record added.");
          resolve(true);
        });
      } //Not empty - just update
      else {
        let updatedRecord = {
          $set: {
            driver_coordinates: relativeHeader.driver_coordinates,
            city: relativeHeader.city,
            country: relativeHeader.country,
            eta: relativeHeader.eta,
            distance: relativeHeader.distance,
            date_updated: new Date(chaineDateUTC),
          },
        };
        //...
        collectionRelativeDistances.updateOne(
          queryChecker,
          updatedRecord,
          function (err, res) {
            //console.log("Updated relative distance record.");
            resolve(true);
          }
        );
      }
    });
}

/**
 * @func cleanAndAdjustRelativeDistancesList
 * Responsible for cleaning the relative distances of drivers and passengers of all false values and
 * limiting the result number based on the @param list_limit parameter
 * @param list_limit: for limiting the result returned or "all" for all the results (not recommended for mobile responses).
 * @param resolve
 */
function cleanAndAdjustRelativeDistancesList(rawList, list_limit = 5, resolve) {
  //Remove any false values
  //? Bypass if all the drivers are required
  rawList = rawList.filter((element) =>
    /all/i.test(list_limit) ? true : element !== false && element.eta !== false
  );
  //Sort based on the distance
  //! Sort normally and place all the nulls at the end for "all"
  rawList = /all/i.test(list_limit)
    ? rawList
        .sort((a, b) => (a.distance === null ? 1 : -1))
        .sort((a, b) =>
          a.distance !== null && b.distance !== null
            ? a.distance - b.distance
            : 1
        )
    : rawList.sort((a, b) => a.distance - b.distance);
  //...
  if (/all/i.test(list_limit)) {
    //All the closest drivers in order
    //Check if there are any results
    if (rawList.length > 0) {
      //has a close driver
      resolve(rawList);
    } //No close drivers
    else {
      resolve({ response: "no_close_drivers_found" });
    }
  } //Limit the results
  else {
    //! Remove drivers with undefined, false or null coordinates
    rawList = rawList.filter((element) =>
      element.driver_coordinates !== undefined &&
      element.driver_coordinates !== false &&
      element.driver_coordinates !== null &&
      element.driver_coordinates.latitude !== undefined &&
      element.driver_coordinates.latitude !== false &&
      element.driver_coordinates.latitude !== null &&
      element.driver_coordinates.longitude !== undefined &&
      element.driver_coordinates.longitude !== false &&
      element.driver_coordinates.longitude !== null &&
      //...
      element.prev_driver_coordinates !== undefined &&
      element.prev_driver_coordinates !== false &&
      element.prev_driver_coordinates !== null &&
      element.prev_driver_coordinates.latitude !== undefined &&
      element.prev_driver_coordinates.latitude !== false &&
      element.prev_driver_coordinates.latitude !== null &&
      element.prev_driver_coordinates.longitude !== undefined &&
      element.prev_driver_coordinates.longitude !== false &&
      element.prev_driver_coordinates.longitude !== null
        ? true
        : false
    );
    //!....
    try {
      list_limit = parseInt(list_limit);
      rawList = rawList.slice(0, list_limit);
      //Check if there are any results
      if (rawList.length > 0) {
        //has a close driver
        resolve(rawList);
      } //No close drivers
      else {
        resolve({ response: "no_close_drivers_found" });
      }
    } catch (error) {
      list_limit = 5;
      rawList = rawList.slice(0, list_limit);
      //Check if there are any results
      if (rawList.length > 0) {
        //has a close driver
        resolve(rawList);
      } //No close drivers
      else {
        resolve({ response: "no_close_drivers_found" });
      }
    }
  }
  //...
}

/**
 * @func getFreshProximity_driversList
 * Responsible for actively get the drivers list proximity and caching the result.
 * @param req: classic request data bundle containing all the neccessary goodies.
 * @param redisKey: the redis key to store the proximity data
 * @param collectionDrivers_profiles: list of all the drivers.
 * @param collectionRidesDeliveries_data: list of all the rides.
 * @param collectionPassengers_profiles: list of all the rides/deliveries
 * @param resolveMother
 *
 * ? includeOfflineDrivers
 * Param used to also include offline drivers with the wanted criteria, very useful for dispatching requests.
 */
function getFreshProximity_driversList(
  req,
  redisKey,
  collectionDrivers_profiles,
  collectionRidesDeliveries_data,
  collectionPassengers_profiles,
  resolveMother
) {
  //Get the list of drivers match the availability criteria
  let driverFilter = {
    "operational_state.status": {
      $regex:
        req.includeOfflineDrivers !== undefined &&
        req.includeOfflineDrivers !== null
          ? /(offline|online)/
          : /online/,
      $options: "i",
    },
    "operational_state.last_location.city": {
      $regex: req.city,
      $options: "i",
    },
    "operational_state.last_location.country": {
      $regex: req.country,
      $options: "i",
    },
    operation_clearances: { $regex: req.ride_type, $options: "i" },
    //Filter the drivers based on the vehicle type if provided
    "operational_state.default_selected_car.vehicle_type":
      req.vehicle_type !== undefined && req.vehicle_type !== false
        ? { $regex: req.vehicle_type, $options: "i" }
        : { $regex: /[a-zA-Z]/, $options: "i" },
  };
  //...
  collectionDrivers_profiles
    .find(driverFilter)
    .toArray(function (err, driversProfiles) {
      //check that some drivers where found
      if (driversProfiles.length > 0) {
        //yep
        //Filter the drivers based on their car's maximum capacity (the amount of passengers it can handle)
        //They can receive 3 additional requests on top of the limit of sits in their selected cars.
        //! Add 30 possible passengers on top of the base passengers limit.
        /*driversProfiles = driversProfiles.filter(
          (dData) =>
            dData.operational_state.accepted_requests_infos === null ||
            dData.operational_state.accepted_requests_infos
              .total_passengers_number <=
              dData.operational_state.default_selected_car.max_passengers +
                30 ||
            dData.operational_state.accepted_requests_infos === undefined ||
            dData.operational_state.accepted_requests_infos === null ||
            dData.operational_state.accepted_requests_infos
              .total_passengers_number === undefined ||
            dData.operational_state.accepted_requests_infos
              .total_passengers_number === null
        );*/
        //...
        let mainPromiser = driversProfiles.map((driverData) => {
          return new Promise((resolve) => {
            //Check for the coords
            if (
              driverData.operational_state.last_location !== null &&
              driverData.operational_state.last_location !== undefined &&
              driverData.operational_state.last_location.coordinates !== null &&
              driverData.operational_state.last_location.coordinates !==
                undefined &&
              driverData.operational_state.last_location.coordinates
                .latitude !== undefined &&
              driverData.operational_state.last_location.coordinates
                .longitude !== undefined
            ) {
              //...
              let tmp = {
                passenger: {
                  latitude: req.org_latitude,
                  longitude: req.org_longitude,
                },
                destination: {
                  latitude:
                    driverData.operational_state.last_location.coordinates
                      .latitude,
                  longitude:
                    driverData.operational_state.last_location.coordinates
                      .longitude,
                },
              };
              let redisKey =
                req.user_fingerprint + "-" + driverData.driver_fingerprint;
              let valueIndex = "relativeEta";
              //CHeck for cache value
              redisGet(redisKey).then(
                (resp) => {
                  if (resp !== null) {
                    //Has some record
                    //Check if the wanted value is present
                    try {
                      resp = JSON.parse(resp);
                      if (
                        resp[valueIndex] !== undefined &&
                        resp[valueIndex] !== null &&
                        resp[valueIndex] !== false
                      ) {
                        //console.log("Foudn cached data");
                        //Update the cache as well
                        new Promise((res) => {
                          getRouteInfosDestination(tmp, res, true, {
                            redisKey: redisKey,
                            valueIndex: valueIndex,
                          }); //Only get simplified data : ETA and distance
                        }).then(
                          () => {},
                          () => {}
                        );
                        //Update the relative mongo records
                        if (
                          resp[valueIndex] !== false &&
                          resp[valueIndex] !== undefined &&
                          resp[valueIndex].eta !== undefined
                        ) {
                          new Promise((res1) => {
                            let relativeHeader = {
                              user_fingerprint: req.user_fingerprint,
                              status: driverData.operational_state.status,
                              driver_fingerprint: driverData.driver_fingerprint,
                              driver_coordinates: {
                                latitude:
                                  driverData.operational_state.last_location
                                    .coordinates.latitude,
                                longitude:
                                  driverData.operational_state.last_location
                                    .coordinates.longitude,
                              },
                              push_notification_token:
                                driverData.push_notification_token,
                              eta: resp[valueIndex].eta,
                              distance: resp[valueIndex].distance,
                              city: req.city,
                              country: req.country,
                            };
                            updateRelativeDistancesRiderDrivers(
                              collectionRelativeDistances,
                              relativeHeader,
                              res1
                            );
                          }).then(
                            () => {},
                            () => {}
                          );
                        }
                        //has something, return that
                        resp[valueIndex].status =
                          driverData.operational_state.status; //? Online or offline
                        resp[valueIndex].driver_fingerprint =
                          driverData.driver_fingerprint; //Add the driver fingerprint to the response
                        resp[valueIndex].driver_coordinates = {
                          latitude:
                            driverData.operational_state.last_location
                              .coordinates.latitude,
                          longitude:
                            driverData.operational_state.last_location
                              .coordinates.longitude,
                        }; //Add the driver coordinates to the response
                        resp[valueIndex].prev_driver_coordinates = {
                          latitude:
                            driverData.operational_state.last_location
                              .prev_coordinates.latitude,
                          longitude:
                            driverData.operational_state.last_location
                              .prev_coordinates.longitude,
                        }; //Add the driver's previous coordinates to the response
                        resp[valueIndex].push_notification_token =
                          driverData.operational_state
                            .push_notification_token !== null &&
                          driverData.operational_state
                            .push_notification_token !== undefined
                            ? driverData.operational_state
                                .push_notification_token.userId
                            : null; //Add the push notification token
                        resolve(resp[valueIndex]);
                      } //The wanted index is not present, make a new search
                      else {
                        new Promise((res) => {
                          getRouteInfosDestination(tmp, res, true, {
                            redisKey: redisKey,
                            valueIndex: valueIndex,
                          }); //Only get simplified data : ETA and distance
                        })
                          .then(
                            (result) => {
                              console.log("HERRRRRE");
                              //Update the relative mongo records
                              if (
                                result !== false &&
                                result !== undefined &&
                                result.eta !== undefined
                              ) {
                                new Promise((res1) => {
                                  let relativeHeader = {
                                    user_fingerprint: req.user_fingerprint,
                                    status: driverData.operational_state.status,
                                    driver_fingerprint:
                                      driverData.driver_fingerprint,
                                    driver_coordinates: {
                                      latitude:
                                        driverData.operational_state
                                          .last_location.coordinates.latitude,
                                      longitude:
                                        driverData.operational_state
                                          .last_location.coordinates.longitude,
                                    },
                                    push_notification_token:
                                      driverData.push_notification_token,
                                    eta: result.eta,
                                    distance: result.distance,
                                    city: req.city,
                                    country: req.country,
                                  };
                                  updateRelativeDistancesRiderDrivers(
                                    collectionRelativeDistances,
                                    relativeHeader,
                                    res1
                                  );
                                }).then(
                                  () => {},
                                  () => {}
                                );
                              }
                              //...
                              result.status =
                                driverData.operational_state.status; //? Online or offline
                              result.driver_fingerprint =
                                driverData.driver_fingerprint; //Add the driver fingerprint to the response
                              result.driver_coordinates = {
                                latitude:
                                  driverData.operational_state.last_location
                                    .coordinates.latitude,
                                longitude:
                                  driverData.operational_state.last_location
                                    .coordinates.longitude,
                              }; //Add the driver coordinates to the response
                              result.prev_driver_coordinates = {
                                latitude:
                                  driverData.operational_state.last_location
                                    .prev_coordinates.latitude,
                                longitude:
                                  driverData.operational_state.last_location
                                    .prev_coordinates.longitude,
                              }; //Add the driver's previous coordinates to the response
                              result.push_notification_token =
                                driverData.operational_state
                                  .push_notification_token !== null &&
                                driverData.operational_state
                                  .push_notification_token !== undefined
                                  ? driverData.operational_state
                                      .push_notification_token.userId
                                  : null; //Add push token
                              resolve(result);
                            },
                            (error) => {
                              console.log(error);
                              let driverRepr = {
                                eta: null,
                                distance: null,
                                status: driverData.operational_state.status,
                                driver_fingerprint:
                                  driverData.driver_fingerprint,
                                driver_coordinates: null,
                                prev_driver_coordinates: null,
                                push_notification_token:
                                  driverData.operational_state
                                    .push_notification_token !== undefined &&
                                  driverData.operational_state
                                    .push_notification_token !== null
                                    ? driverData.operational_state
                                        .push_notification_token.userId
                                    : null,
                              };
                              resolve(driverRepr);
                            }
                          )
                          .catch((error) => {
                            console.log(error);
                            let driverRepr = {
                              eta: null,
                              distance: null,
                              status: driverData.operational_state.status,
                              driver_fingerprint: driverData.driver_fingerprint,
                              driver_coordinates: null,
                              prev_driver_coordinates: null,
                              push_notification_token:
                                driverData.operational_state
                                  .push_notification_token !== undefined &&
                                driverData.operational_state
                                  .push_notification_token !== null
                                  ? driverData.operational_state
                                      .push_notification_token.userId
                                  : null,
                            };
                            resolve(driverRepr);
                          });
                      }
                    } catch (error) {
                      console.log(error);
                      //Make a fresh search
                      new Promise((res) => {
                        getRouteInfosDestination(tmp, res, true, {
                          redisKey: redisKey,
                          valueIndex: valueIndex,
                        }); //Only get simplified data : ETA and distance
                      })
                        .then(
                          (result) => {
                            //Update the relative mongo records
                            if (
                              result !== false &&
                              result !== undefined &&
                              result.eta !== undefined
                            ) {
                              new Promise((res1) => {
                                let relativeHeader = {
                                  user_fingerprint: req.user_fingerprint,
                                  status: driverData.operational_state.status,
                                  driver_fingerprint:
                                    driverData.driver_fingerprint,
                                  driver_coordinates: {
                                    latitude:
                                      driverData.operational_state.last_location
                                        .coordinates.latitude,
                                    longitude:
                                      driverData.operational_state.last_location
                                        .coordinates.longitude,
                                  },
                                  push_notification_token:
                                    driverData.push_notification_token,
                                  eta: result.eta,
                                  distance: result.distance,
                                  city: req.city,
                                  country: req.country,
                                };
                                updateRelativeDistancesRiderDrivers(
                                  collectionRelativeDistances,
                                  relativeHeader,
                                  res1
                                );
                              }).then(
                                () => {},
                                () => {}
                              );
                            }
                            //...
                            result.status = driverData.operational_state.status; //? Online or offline
                            result.driver_fingerprint =
                              driverData.driver_fingerprint; //Add the driver fingerprint to the response
                            result.driver_coordinates = {
                              latitude:
                                driverData.operational_state.last_location
                                  .coordinates.latitude,
                              longitude:
                                driverData.operational_state.last_location
                                  .coordinates.longitude,
                            }; //Add the driver coordinates to the response
                            result.prev_driver_coordinates = {
                              latitude:
                                driverData.operational_state.last_location
                                  .prev_coordinates.latitude,
                              longitude:
                                driverData.operational_state.last_location
                                  .prev_coordinates.longitude,
                            }; //Add the driver's previous coordinates to the response
                            result.push_notification_token =
                              driverData.operational_state
                                .push_notification_token !== null &&
                              driverData.operational_state
                                .push_notification_token !== undefined
                                ? driverData.operational_state
                                    .push_notification_token.userId
                                : null; //Add push token
                            resolve(result);
                          },
                          (error) => {
                            console.log(error);
                            let driverRepr = {
                              eta: null,
                              distance: null,
                              status: driverData.operational_state.status,
                              driver_fingerprint: driverData.driver_fingerprint,
                              driver_coordinates: null,
                              prev_driver_coordinates: null,
                              push_notification_token:
                                driverData.operational_state
                                  .push_notification_token !== undefined &&
                                driverData.operational_state
                                  .push_notification_token !== null
                                  ? driverData.operational_state
                                      .push_notification_token.userId
                                  : null,
                            };
                            resolve(driverRepr);
                          }
                        )
                        .catch((error) => {
                          console.log(error);
                          let driverRepr = {
                            eta: null,
                            distance: null,
                            status: driverData.operational_state.status,
                            driver_fingerprint: driverData.driver_fingerprint,
                            driver_coordinates: null,
                            prev_driver_coordinates: null,
                            push_notification_token:
                              driverData.operational_state
                                .push_notification_token !== undefined &&
                              driverData.operational_state
                                .push_notification_token !== null
                                ? driverData.operational_state
                                    .push_notification_token.userId
                                : null,
                          };
                          resolve(driverRepr);
                        });
                    }
                  } //No records make a fresh search
                  else {
                    new Promise((res) => {
                      getRouteInfosDestination(tmp, res, true, {
                        redisKey: redisKey,
                        valueIndex: valueIndex,
                      }); //Only get simplified data : ETA and distance
                    }).then(
                      (result) => {
                        //Update the relative mongo records
                        if (
                          result !== false &&
                          result !== undefined &&
                          result.eta !== undefined
                        ) {
                          new Promise((res1) => {
                            let relativeHeader = {
                              user_fingerprint: req.user_fingerprint,
                              status: driverData.operational_state.status,
                              driver_fingerprint: driverData.driver_fingerprint,
                              driver_coordinates: {
                                latitude:
                                  driverData.operational_state.last_location
                                    .coordinates.latitude,
                                longitude:
                                  driverData.operational_state.last_location
                                    .coordinates.longitude,
                              },
                              push_notification_token:
                                driverData.push_notification_token,
                              eta: result.eta,
                              distance: result.distance,
                              city: req.city,
                              country: req.country,
                            };
                            updateRelativeDistancesRiderDrivers(
                              collectionRelativeDistances,
                              relativeHeader,
                              res1
                            );
                          }).then(
                            () => {},
                            () => {}
                          );
                        }
                        //...
                        result.status = driverData.operational_state.status; //? Online or offline
                        result.driver_fingerprint =
                          driverData.driver_fingerprint; //Add the driver fingerprint to the response
                        result.driver_coordinates = {
                          latitude:
                            driverData.operational_state.last_location
                              .coordinates.latitude,
                          longitude:
                            driverData.operational_state.last_location
                              .coordinates.longitude,
                        }; //Add the driver coordinates to the response
                        result.prev_driver_coordinates = {
                          latitude:
                            driverData.operational_state.last_location
                              .prev_coordinates.latitude,
                          longitude:
                            driverData.operational_state.last_location
                              .prev_coordinates.longitude,
                        }; //Add the driver's previous coordinates to the response
                        result.push_notification_token =
                          driverData.operational_state
                            .push_notification_token !== null &&
                          driverData.operational_state
                            .push_notification_token !== undefined
                            ? driverData.operational_state
                                .push_notification_token.userId
                            : null; //Add push token
                        resolve(result);
                      },
                      (error) => {
                        console.log(error);
                        let driverRepr = {
                          eta: null,
                          distance: null,
                          status: driverData.operational_state.status,
                          driver_fingerprint: driverData.driver_fingerprint,
                          driver_coordinates: null,
                          prev_driver_coordinates: null,
                          push_notification_token:
                            driverData.operational_state
                              .push_notification_token !== undefined &&
                            driverData.operational_state
                              .push_notification_token !== null
                              ? driverData.operational_state
                                  .push_notification_token.userId
                              : null,
                        };
                        resolve(driverRepr);
                      }
                    );
                  }
                },
                (error) => {
                  console.log(error);
                  //Make a fresh search
                  new Promise((res) => {
                    getRouteInfosDestination(tmp, res, true, {
                      redisKey: redisKey,
                      valueIndex: valueIndex,
                    }); //Only get simplified data : ETA and distance
                  }).then(
                    (result) => {
                      //Update the relative mongo records
                      if (
                        result !== false &&
                        result !== undefined &&
                        result.eta !== undefined
                      ) {
                        new Promise((res1) => {
                          let relativeHeader = {
                            user_fingerprint: req.user_fingerprint,
                            status: driverData.operational_state.status,
                            driver_fingerprint: driverData.driver_fingerprint,
                            driver_coordinates: {
                              latitude:
                                driverData.operational_state.last_location
                                  .coordinates.latitude,
                              longitude:
                                driverData.operational_state.last_location
                                  .coordinates.longitude,
                            },
                            push_notification_token:
                              driverData.push_notification_token,
                            eta: result.eta,
                            distance: result.distance,
                            city: req.city,
                            country: req.country,
                          };
                          updateRelativeDistancesRiderDrivers(
                            collectionRelativeDistances,
                            relativeHeader,
                            res1
                          );
                        }).then(
                          () => {},
                          () => {}
                        );
                      }
                      //...
                      result.status = driverData.operational_state.status; //? Online or offline
                      result.driver_fingerprint = driverData.driver_fingerprint; //Add the driver fingerprint to the response
                      result.driver_coordinates = {
                        latitude:
                          driverData.operational_state.last_location.coordinates
                            .latitude,
                        longitude:
                          driverData.operational_state.last_location.coordinates
                            .longitude,
                      }; //Add the driver coordinates to the response
                      result.prev_driver_coordinates = {
                        latitude:
                          driverData.operational_state.last_location
                            .prev_coordinates.latitude,
                        longitude:
                          driverData.operational_state.last_location
                            .prev_coordinates.longitude,
                      }; //Add the driver's previous coordinates to the response
                      result.push_notification_token =
                        driverData.operational_state.push_notification_token !==
                          null &&
                        driverData.operational_state.push_notification_token !==
                          undefined
                          ? driverData.operational_state.push_notification_token
                              .userId
                          : null; //Add push token
                      resolve(result);
                    },
                    (error) => {
                      console.log(error);
                      let driverRepr = {
                        eta: null,
                        distance: null,
                        status: driverData.operational_state.status,
                        driver_fingerprint: driverData.driver_fingerprint,
                        driver_coordinates: null,
                        prev_driver_coordinates: null,
                        push_notification_token:
                          driverData.operational_state
                            .push_notification_token !== undefined &&
                          driverData.operational_state
                            .push_notification_token !== null
                            ? driverData.operational_state
                                .push_notification_token.userId
                            : null,
                      };
                      resolve(driverRepr);
                    }
                  );
                }
              );
            } else {
              //! Form a driver with null values for positionning
              let driverRepr = {
                eta: null,
                distance: null,
                status: driverData.operational_state.status,
                driver_fingerprint: driverData.driver_fingerprint,
                driver_coordinates: null,
                prev_driver_coordinates: null,
                push_notification_token:
                  driverData.operational_state.push_notification_token !==
                    undefined &&
                  driverData.operational_state.push_notification_token !== null
                    ? driverData.operational_state.push_notification_token
                        .userId
                    : null,
              };
              resolve(driverRepr);
            }
          });
        });
        //Resolve all
        Promise.all(mainPromiser).then(
          (result) => {
            //Done- exlude all false
            new Promise((res) => {
              cleanAndAdjustRelativeDistancesList(result, req.list_limit, res);
            }).then(
              (reslt) => {
                //! Cache the list for 10minutes
                new Promise((resCacheDriversList) => {
                  client.setex(
                    redisKey,
                    process.env.REDIS_EXPIRATION_5MIN,
                    stringify(reslt),
                    redis.print
                  );
                  resCacheDriversList(true);
                })
                  .then(
                    () => {
                      console.log("DRIVERS LIST CACHED");
                    },
                    () => {}
                  )
                  .catch((error) => {
                    console.log(error);
                  });
                //? DONE
                resolveMother(reslt);
              },
              (error) => {
                console.log(error);
                resolveMother({ response: "no_close_drivers_found" });
              }
            );
          },
          (error) => {
            console.log(error);
            resolveMother({ response: "no_close_drivers_found" });
          }
        );
      } //No close drivers
      else {
        resolveMother({ response: "no_close_drivers_found" });
      }
    });
}

/**
 * MAIN
 */

clientMongo.connect(function (err) {
  //if (err) throw err;
  console.log("[+] MAP services active.");
  const dbMongo = clientMongo.db(process.env.DB_NAME_MONGODDB);
  const collectionRidesDeliveries_data = dbMongo.collection(
    "rides_deliveries_requests"
  ); //Hold all the requests made (rides and deliveries)
  const collectionRelativeDistances = dbMongo.collection(
    "relative_distances_riders_drivers"
  ); //Hold the relative distances between rider and the drivers (online, same city, same country) at any given time
  const collectionRidersLocation_log = dbMongo.collection(
    "historical_positioning_logs"
  ); //Hold all the location updated from the rider
  const collectionDrivers_profiles = dbMongo.collection("drivers_profiles"); //Hold all the drivers profiles
  const collectionPassengers_profiles = dbMongo.collection(
    "passengers_profiles"
  ); //Hold all the passengers profiles.
  const collectionGlobalEvents = dbMongo.collection("global_events"); //Hold all the random events that happened somewhere.
  const collectionWalletTransactions_logs = dbMongo.collection(
    "wallet_transactions_logs"
  ); //Hold the latest information about the riders topups
  //-------------
  const bodyParser = require("body-parser");
  app
    .get("/", function (req, res) {
      res.send("Map services up");
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

  //Ride tracking for customers to see real-time drivers positions
  /*socket.on("trackdriverroute", function (coordsData) {
    //console.log(coordsData);
    logToSimulator(socket, coordsData);
    if (coordsData !== undefined && coordsData != null && coordsData.driver.latitude !== undefined && coordsData.passenger.latitude !== undefined) {
      let request0 = new Promise((resolve) => {
        getRouteInfos(coordsData, resolve);
      }).then(
        (result) => {
          //console.log(result);
          logToSimulator(socket, result);
          socket.emit("trackdriverroute-response", result);
        },
        (error) => {
          //console.log(error);
          logToSimulator(socket, error);
          socket.emit("trackdriverroute-response", { response: false });
        }
      );
    } else {
      socket.emit("trackdriverroute-response", { response: false });
    }
  });*/

  //Get itinary informations for ride - passengers
  /*socket.on("getIteinerayDestinationInfos", function (coordsData) {
    //console.log(coordsData);
    if (coordsData !== undefined && coordsData != null && coordsData.driver.latitude !== undefined && coordsData.passenger.latitude !== undefined) {
      let request0 = new Promise((resolve) => {
        getRouteInfos(coordsData, resolve);
      }).then(
        (result) => {
          ////console.log(result);
          socket.emit("getIteinerayDestinationInfos-response", result);
        },
        (error) => {
          //console.log(error);
          socket.emit("getIteinerayDestinationInfos-response", { response: false });
        }
      );
    } else {
      socket.emit("getIteinerayDestinationInfos-response", { response: false });
    }
  });*/

  /**
   * PASSENGER/DRIVER LOCATION UPDATE MANAGER
   * Responsible for updating in the databse and other caches new passenger's/rider's locations received.
   * Update CACHE -> MONGODB (-> TRIP CHECKER DISPATCHER)
   */
  app.post("/updatePassengerLocation", function (req, res) {
    resolveDate();
    //DEBUG
    /*let testData = {
      latitude: -22.5704981,
      longitude: 17.0809425,
      user_fingerprint:
        "23c9d088e03653169b9c18193a0b8dd329ea1e43eb0626ef9f16b5b979694a429710561a3cb3ddae",
      user_nature: "driver",
      requestType: "scheduled",
      pushnotif_token: {
        hasNotificationPermission: true,
        isEmailSubscribed: false,
        isPushDisabled: false,
        isSubscribed: true,
        pushToken:
          "fNA8f12fQ225K3IHb4Xwdf:APA91bGQW7bJrNzOcIslIDTApTenhWaueP9QC-EJN4IM7ugZm43sJlk8jsj-lJxJN8JB70NsA5ZsDah2egABIm7L3ex-hndQiJEI-ziBggaO0se0rBI3CEE6ytpY2-USaM3yXe3HqKW9",
        userId: "a0989fbc-2ec1-4b9c-b469-881dfaa345d8",
      },
    };
    req = testData;*/
    //DEBUG
    //let params = urlParser.parse(req.url, true);
    req = req.body;
    console.log(req);

    if (
      req !== undefined &&
      req.latitude !== undefined &&
      req.latitude !== null &&
      req.longitude !== undefined &&
      req.longitude !== null &&
      req.user_fingerprint !== null &&
      req.user_fingerprint !== undefined
    ) {
      //? Update the rider's push notification var only if got a new value
      new Promise((resUpdateNotifToken) => {
        if (
          req.pushnotif_token.userId !== undefined &&
          req.pushnotif_token.userId !== null &&
          req.pushnotif_token.userId.length > 3
        ) {
          //Got something - can update
          if (/^rider$/i.test(req.user_nature)) {
            //Rider
            collectionPassengers_profiles.updateOne(
              { user_fingerprint: req.user_fingerprint },
              {
                $set: {
                  pushnotif_token: JSON.parse(req.pushnotif_token),
                  last_updated: new Date(chaineDateUTC),
                },
              },
              function (err, reslt) {
                console.log("HERE");
                if (err) {
                  console.log(err);
                  resUpdateNotifToken(false);
                }
                //...
                resUpdateNotifToken(true);
              }
            );
          } else if (/^driver$/i.test(req.user_nature)) {
            //Driver
            //! Update the payment cycle starting point if not set yet
            new Promise((resPaymentCycle) => {
              //!Check if a reference point exists - if not set one to NOW
              //? For days before wednesday, set to wednesdat and for those after wednesday, set to next week that same day.
              //! Annotation string: startingPoint_forFreshPayouts
              collectionWalletTransactions_logs
                .find({
                  flag_annotation: {
                    $regex: /startingPoint_forFreshPayouts/,
                    $options: "i",
                  },
                  user_fingerprint: req.user_fingerprint,
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
                    resPaymentCycle(true);
                  } //No annotation yet - create one
                  else {
                    let tmpDate = new Date(chaineDateUTC)
                      .toDateString()
                      .split(" ")[0];
                    if (/(mon|tue)/i.test(tmpDate)) {
                      //For mondays and tuesdays - add 3 days + the PAYMENT CYCLE
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
                      collectionWalletTransactions_logs.insertOne(
                        {
                          flag_annotation: "startingPoint_forFreshPayouts",
                          user_fingerprint: req.user_fingerprint,
                          date_captured: new Date(tmpNextDate),
                        },
                        function (err, reslt) {
                          resPaymentCycle(true);
                        }
                      );
                    } //After wednesday - OK
                    else {
                      //ADD THE PAYMENT CYCLE
                      let tmpNextDate = new Date(
                        new Date(chaineDateUTC).getTime() +
                          parseFloat(
                            process.env.TAXICONNECT_PAYMENT_FREQUENCY *
                              24 *
                              3600 *
                              1000
                          )
                      ).toISOString();
                      collectionWalletTransactions_logs.insertOne(
                        {
                          flag_annotation: "startingPoint_forFreshPayouts",
                          user_fingerprint: req.user_fingerprint,
                          date_captured: new Date(tmpNextDate),
                        },
                        function (err, reslt) {
                          resPaymentCycle(true);
                        }
                      );
                    }
                  }
                });
            }).then(
              () => {},
              () => {}
            );
            //...
            collectionDrivers_profiles.updateOne(
              { driver_fingerprint: req.user_fingerprint },
              {
                $set: {
                  "operational_state.push_notification_token": JSON.parse(
                    req.pushnotif_token
                  ),
                  date_updated: new Date(chaineDateUTC),
                },
              },
              function (err, reslt) {
                if (err) {
                  resUpdateNotifToken(false);
                }
                //...
                resUpdateNotifToken(true);
              }
            );
          } //Invalid user nature - skip
          else {
            resUpdateNotifToken(false);
          }
        } //Got invalid data - skip
        else {
          resUpdateNotifToken(false);
        }
      }).then(
        () => {},
        () => {}
      );

      let timeTaken = new Date();
      timeTaken = timeTaken.getTime();
      //Check for any existing ride
      new Promise((res) => {
        //console.log("fetching data");
        tripChecker_Dispatcher(
          collectionRidesDeliveries_data,
          collectionDrivers_profiles,
          collectionPassengers_profiles,
          req.user_fingerprint,
          req.user_nature !== undefined && req.user_nature !== null
            ? req.user_nature
            : "rider",
          req.requestType !== undefined && req.requestType !== null
            ? req.requestType
            : "rides",
          res
        );
      }).then(
        (result) => {
          let doneTime = new Date();
          timeTaken = doneTime.getTime() - timeTaken;
          //Update the rider
          if (result !== false) {
            if (result != "no_rides") {
              res.send(result);
            } //No rides
            else {
              res.send({ request_status: "no_rides" });
            }
          } //No rides
          else {
            res.send({ request_status: "no_rides" });
          }
        },
        (error) => {
          console.log(error);
          res.send({ request_status: "no_rides" });
        }
      );

      //Update cache for this user's location
      new Promise((resolve1) => {
        updateRiderLocationInfosCache(req, resolve1);
      }).then(
        () => {
          //console.log("updated cache");
        },
        () => {}
      );

      //Update rider's location - promise always
      new Promise((resolve2) => {
        updateRidersRealtimeLocationData(
          collectionRidersLocation_log,
          collectionDrivers_profiles,
          collectionPassengers_profiles,
          req,
          resolve2
        );
      }).then(
        () => {
          //console.log("Location updated [rider]");
        },
        () => {}
      );
    } //Invalid data
    else {
      res.send({ request_status: "no_rides" });
    }
  });

  /**
   * REVERSE GEOCODER
   * To get the exact approx. location of the user or driver.
   * REDIS propertiy
   * user_fingerprint -> currentLocationInfos: {...}
   */
  app.get("/getUserLocationInfos", function (req, res) {
    let params = urlParser.parse(req.url, true);
    //console.log(params.query);
    let request = params.query;

    if (
      request.latitude != undefined &&
      request.latitude != null &&
      request.longitude != undefined &&
      request.longitude != null &&
      request.user_fingerprint !== null &&
      request.user_fingerprint !== undefined
    ) {
      //Hand responses
      new Promise((resolve) => {
        reverseGeocodeUserLocation(resolve, request);
      }).then(
        (result) => {
          res.send(result);
        },
        (error) => {
          res.send(false);
        }
      );
    }
  });

  /**
   * PLACES IDENTIFIER
   * Route name: identifyPickupLocation
   * ? Responsible for finding out the nature of places (ge. Private locations, taxi ranks or other specific plcaes of interest)
   * This one will only focus on Pvate locations AND taxi ranks.
   * False means : not a taxirank -> private location AND another object means taxirank
   */
  app.get("/identifyPickupLocation", function (req, res) {
    let params = urlParser.parse(req.url, true);
    req = params.query;
    //...
    if (
      req.latitude !== undefined &&
      req.latitude !== null &&
      req.longitude !== undefined &&
      req.longitude !== null &&
      req.user_fingerprint !== undefined &&
      req.user_fingerprint !== null
    ) {
      new Promise((res) => {
        findoutPickupLocationNature(res, req);
      }).then(
        (result) => {
          res.send(result);
        },
        (error) => {
          //Default to private location on error
          res.send({ locationType: "PrivateLocation" });
        }
      );
    } //Default to private location - invalid params
    else {
      res.send({ locationType: "PrivateLocation" });
    }
  });

  /**
   * ROUTE TO DESTINATION previewer
   * Responsible for showing to the user the preview of the first destination after selecting on the app the destination.
   */
  app.get("/getRouteToDestinationSnapshot", function (req, res) {
    let params = urlParser.parse(req.url, true);
    req = params.query;
    console.log("here");
    //...
    if (
      req.user_fingerprint !== undefined &&
      req.org_latitude !== undefined &&
      req.org_longitude !== undefined
    ) {
      new Promise((res) => {
        let tmp = {
          origin: {
            latitude: req.org_latitude,
            longitude: req.org_longitude,
          },
          destination: {
            latitude: req.dest_latitude,
            longitude: req.dest_longitude,
          },
          user_fingerprint: req.user_fingerprint,
          request_fp:
            req.request_fp !== undefined && req.request_fp !== null
              ? req.request_fp
              : false,
        };
        findDestinationPathPreview(res, tmp);
      }).then(
        (result) => {
          res.send(result);
        },
        (error) => {
          console.log(error);
          res.send(false);
        }
      );
    } //error
    else {
      res.send(false);
    }
  });

  /**
   * GET VITALS ETAs OR ROUTE INFOS
   * Responsible for returning the ordered list (any specified number) of all the closest online drivers IF ANY (finds Etas or route infos between 2 points natively).
   * The details of the response must inlude the drives fingerprints, the eta and the distances.
   * Drivers filter criteria: should be online, should be able to pick up, same city, same country.
   * @param user_fingerprint: the rider's fingerprint
   * @param org_latitude: rider's latitude
   * @param org_longitude: rider's longitude
   * @param city: rider's city
   * @param country: rider's country
   * @param list_limit: the number of the closest drivers to fetch, OR "all" for the full list (very important after requesting a ride or delivery) - default: 7
   * @param ride_type: RIDE or DELIVERY (depending on which scenario it is) - should match the operation clearances for the drivers
   * @param make_new: whether or not to return the cached result first (false) or the compute fresh results (true)
   * VERY IMPORTANT FOR BACH RIDER - DRIVERS MATCHING.
   * Redis key: user_fingerprint-driver-fingerprint
   * valueIndex: 'relativeEta'
   */
  app.get("/getVitalsETAOrRouteInfos2points", function (req, res) {
    let params = urlParser.parse(req.url, true);
    req = params.query;
    //...
    if (
      req.user_fingerprint !== undefined &&
      req.org_latitude !== undefined &&
      req.org_longitude !== undefined &&
      req.city !== undefined &&
      req.country !== undefined &&
      req.ride_type !== undefined
    ) {
      //? Form the redis key
      let redisKey = `${req.user_fingerprint}-driversListCachedData`;
      //Check the list limit
      if (req.list_limit === undefined) {
        req.list_limit = 7;
      }
      //! CHECK FOR CACHED RESULT FIRST IF INSTRUCTED SO
      if (
        req.make_new !== undefined ||
        req.make_new === "true" ||
        req.make_new
      ) {
        console.log("MAKE NEW");
        //Get the list of drivers match the availability criteria
        new Promise((resGetFreshList) => {
          getFreshProximity_driversList(
            req,
            redisKey,
            collectionDrivers_profiles,
            collectionRidesDeliveries_data,
            collectionPassengers_profiles,
            resGetFreshList
          );
        })
          .then(
            (result) => {
              //? DONE
              res.send(result);
            },
            (error) => {
              console.log(error);
              res.send({ response: "no_close_drivers_found" });
            }
          )
          .catch((error) => {
            console.log(error);
            res.send({ response: "no_close_drivers_found" });
          });
      } //Get the cached first
      else {
        console.log("Get cached first");
        redisGet(redisKey)
          .then(
            (resp) => {
              if (resp !== null) {
                console.log("FOUND CACHED DRIVER LIST");
                //Has some cached data
                try {
                  //Rehydrate the data
                  new Promise((resGetFreshList) => {
                    getFreshProximity_driversList(
                      req,
                      redisKey,
                      collectionDrivers_profiles,
                      collectionRidesDeliveries_data,
                      collectionPassengers_profiles,
                      resGetFreshList
                    );
                  })
                    .then(
                      (result) => {
                        //? DONE
                      },
                      (error) => {
                        console.log(error);
                      }
                    )
                    .catch((error) => {
                      console.log(error);
                    });
                  //...
                  resp = parse(resp);
                  //? Quickly respond
                  res.send(resp);
                } catch (error) {
                  console.log(error);
                  //Get the list of drivers match the availability criteria
                  new Promise((resGetFreshList) => {
                    getFreshProximity_driversList(
                      req,
                      redisKey,
                      collectionDrivers_profiles,
                      collectionRidesDeliveries_data,
                      collectionPassengers_profiles,
                      resGetFreshList
                    );
                  })
                    .then(
                      (result) => {
                        //? DONE
                        res.send(result);
                      },
                      (error) => {
                        console.log(error);
                        res.send({ response: "no_close_drivers_found" });
                      }
                    )
                    .catch((error) => {
                      console.log(error);
                      res.send({ response: "no_close_drivers_found" });
                    });
                }
              } //No cached data - get fresh one
              else {
                //Get the list of drivers match the availability criteria
                new Promise((resGetFreshList) => {
                  getFreshProximity_driversList(
                    req,
                    redisKey,
                    collectionDrivers_profiles,
                    collectionRidesDeliveries_data,
                    collectionPassengers_profiles,
                    resGetFreshList
                  );
                })
                  .then(
                    (result) => {
                      //? DONE
                      res.send(result);
                    },
                    (error) => {
                      console.log(error);
                      res.send({ response: "no_close_drivers_found" });
                    }
                  )
                  .catch((error) => {
                    console.log(error);
                    res.send({ response: "no_close_drivers_found" });
                  });
              }
            },
            (error) => {
              console.log(error);
              //Get the list of drivers match the availability criteria
              new Promise((resGetFreshList) => {
                getFreshProximity_driversList(
                  req,
                  redisKey,
                  collectionDrivers_profiles,
                  collectionRidesDeliveries_data,
                  collectionPassengers_profiles,
                  resGetFreshList
                );
              })
                .then(
                  (result) => {
                    //? DONE
                    res.send(result);
                  },
                  (error) => {
                    console.log(error);
                    res.send({ response: "no_close_drivers_found" });
                  }
                )
                .catch((error) => {
                  console.log(error);
                  res.send({ response: "no_close_drivers_found" });
                });
            }
          )
          .catch((error) => {
            console.log(error);
            //Get the list of drivers match the availability criteria
            new Promise((resGetFreshList) => {
              getFreshProximity_driversList(
                req,
                redisKey,
                collectionDrivers_profiles,
                collectionRidesDeliveries_data,
                collectionPassengers_profiles,
                resGetFreshList
              );
            })
              .then(
                (result) => {
                  //? DONE
                  res.send(result);
                },
                (error) => {
                  console.log(error);
                  res.send({ response: "no_close_drivers_found" });
                }
              )
              .catch((error) => {
                console.log(error);
                res.send({ response: "no_close_drivers_found" });
              });
          });
      }
    } else {
      res.send({ response: "no_close_drivers_found" });
    }
  });

  /**
   * PROVIDE REALTIME ROUTE TRACKING DATA
   * Responsible for computing, caching and delivering real-time tracking information from  point A to a point B.
   * Include the direction intructions.
   * @param user_fingerprint: the user's fingerprint.
   * @param request_fp: the request fingerprint or unique identifiyer of the operation that requires the active tracking.
   * @param org_latitude: latitude of the origin point
   * @param org_longitude: longitude of the origin point
   * @param dest_latitude: latitude of the destination point.
   * @param dest_longitude: longitude of the destination point.
   * Redis key format: realtime-tracking-operation-user_fingerprint-request_fp
   */
  app.get("/getRealtimeTrackingRoute_forTHIS", function (req, res) {
    let params = urlParser.parse(req.url, true);
    req = params.query;

    if (
      req.user_fingerprint !== undefined &&
      req.user_fingerprint !== null &&
      req.request_fp !== undefined &&
      req.request_fp !== null &&
      req.org_latitude !== undefined &&
      req.org_latitude !== null &&
      req.org_longitude !== undefined &&
      req.org_longitude !== null &&
      req.dest_latitude !== undefined &&
      req.dest_latitude !== null
    ) {
      //Valid format
      //Create the redis key
      let redisKey =
        "realtime-tracking-operation-" +
        req.user_fingerprint +
        "-" +
        req.request_fp;
      //Get the cached data first if any
      redisGet(redisKey).then(
        (resp) => {
          if (resp !== null) {
            //Has a previous recordd
            try {
              //Update the old cache
              new Promise((res0) => {
                getRouteInfosDestination(
                  {
                    passenger: {
                      latitude: req.org_latitude,
                      longitude: req.org_longitude,
                    },
                    destination: {
                      latitude: req.dest_latitude,
                      longitude: req.dest_longitude,
                    },
                    setIntructions: true,
                  },
                  res0,
                  false,
                  false
                );
              }).then(
                (result) => {
                  //Update cache if the result is not fallsee
                  if (result !== false) {
                    client.set(redisKey, JSON.stringify(result));
                  }
                },
                (error) => {
                  console.log(error);
                }
              );
              //.....
              resp = JSON.parse(resp);
              console.log("Found realtime REDIS record!");
              //Quickly return data
              res.send(resp);
            } catch (error) {
              console.log(error);
              //Error - make a fresh search
              new Promise((res0) => {
                getRouteInfosDestination(
                  {
                    passenger: {
                      latitude: req.org_latitude,
                      longitude: req.org_longitude,
                    },
                    destination: {
                      latitude: req.dest_latitude,
                      longitude: req.dest_longitude,
                    },
                    setIntructions: true,
                  },
                  res0,
                  false,
                  false
                );
              }).then(
                (result) => {
                  //Update cache if the result is not fallsee
                  if (result !== false) {
                    client.set(redisKey, JSON.stringify(result));
                    //...
                    res.send(result);
                  } //Error
                  else {
                    res.send(false);
                  }
                },
                (error) => {
                  console.log(error);
                  //...
                  res.send(false);
                }
              );
            }
          } //No previous record - make a fresh search
          else {
            new Promise((res0) => {
              getRouteInfosDestination(
                {
                  passenger: {
                    latitude: req.org_latitude,
                    longitude: req.org_longitude,
                  },
                  destination: {
                    latitude: req.dest_latitude,
                    longitude: req.dest_longitude,
                  },
                  setIntructions: true,
                },
                res0,
                false,
                false
              );
            }).then(
              (result) => {
                //Update cache if the result is not fallsee
                if (result !== false) {
                  client.set(redisKey, JSON.stringify(result));
                  //...
                  res.send(result);
                } //Error
                else {
                  res.send(false);
                }
              },
              (error) => {
                console.log(error);
                //...
                res.send(false);
              }
            );
          }
        },
        (error) => {
          console.log(error);
          //Error - make a fresh search
          new Promise((res0) => {
            getRouteInfosDestination(
              {
                passenger: {
                  latitude: req.org_latitude,
                  longitude: req.org_longitude,
                },
                destination: {
                  latitude: req.dest_latitude,
                  longitude: req.dest_longitude,
                },
                setIntructions: true,
              },
              res0,
              false,
              false
            );
          }).then(
            (result) => {
              //Update cache if the result is not fallsee
              if (result !== false) {
                client.set(redisKey, JSON.stringify(result));
                //...
                res.send(result);
              } //Error
              else {
                res.send(false);
              }
            },
            (error) => {
              console.log(error);
              //...
              res.send(false);
            }
          );
        }
      );
    } //Invalid data
    else {
      res.send(false);
    }
  });

  /**
   * GET THE NECESSARY INFOS FOR ONLY THE SHARED TRIPS.
   * Responsible for retrieving data about any shared trips from one user to one or many others.
   * @param sharedTo_user_fingerprint: the fingerprint of the user to which the request was shared to.
   * @param trip_simplified_id: the simplified request fp of the ride.
   * ! Can only share rides for now.
   */
  app.get("/getSharedTrip_information", function (req, res) {
    resolveDate();
    let params = urlParser.parse(req.url, true);
    req = params.query;

    if (
      req.sharedTo_user_fingerprint !== undefined &&
      req.sharedTo_user_fingerprint !== null &&
      req.trip_simplified_id !== undefined &&
      req.trip_simplified_id !== null
    ) {
      let timeTaken = new Date();
      timeTaken = timeTaken.getTime();
      //Get the user fingerprint of the owner of this ride as long as it is still active
      collectionRidesDeliveries_data
        .find({ trip_simplified_id: req.trip_simplified_id })
        .toArray(function (err, parentTripDetails) {
          if (err) {
            res.send({ request_status: "no_rides" });
          }
          //...
          if (parentTripDetails.length > 0) {
            //There's a trip in progress
            //Save the event of an external user getting the trip infos and all the corresponding data
            let eventBundle = {
              sharedTo_user_fingerprint: req.sharedTo_user_fingerprint,
              trip_simplified_id: req.trip_simplified_id,
              owner_rider_fingerprint: parentTripDetails[0].client_id,
              request_fp: parentTripDetails[0].request_fp,
              response_got: null, //The response of the request.
              date_captured: new Date(chaineDateUTC),
            };
            //Check for any existing ride
            new Promise((res) => {
              //console.log("fetching data");
              tripChecker_Dispatcher(
                collectionRidesDeliveries_data,
                collectionDrivers_profiles,
                collectionPassengers_profiles,
                parentTripDetails[0].client_id,
                "rider",
                "rides",
                res
              );
            }).then(
              (result) => {
                let doneTime = new Date();
                timeTaken = doneTime.getTime() - timeTaken;
                //console.log("[" + chaineDateUTC + "] Compute and dispatch time (trip) ------>  " + timeTaken + " ms");
                //Save the shared result event
                new Promise((resSharedEvent) => {
                  //Complete the event bundle with the response of the request
                  eventBundle.response_got = result;
                  collectionGlobalEvents.insertOne(
                    eventBundle,
                    function (err, reslt) {
                      resSharedEvent(true);
                    }
                  );
                }).then(
                  () => {
                    console.log("Save the shared ride event");
                  },
                  () => {}
                );
                //Update the rider
                if (result !== false) {
                  if (result != "no_rides") {
                    //!Get the sender's details and attach it the to response
                    collectionPassengers_profiles
                      .find({
                        user_fingerprint: parentTripDetails[0].client_id,
                      })
                      .toArray(function (err, riderTripOwner) {
                        if (err) {
                          console.log(err);
                          res.send({ request_status: "no_rides" });
                        }
                        //...
                        if (
                          riderTripOwner.length > 0 &&
                          riderTripOwner[0].user_fingerprint !== undefined
                        ) {
                          //Found the owner of the ride
                          let ownerInfoBundle = {
                            name: riderTripOwner[0].name,
                            profile_picture: `${process.env.AWS_S3_RIDERS_PROFILE_PICTURES_PATH}/${riderTripOwner[0].media.profile_picture}`,
                          };
                          //? attach to the global trip details AND the success status
                          result["riderOwnerInfoBundle"] = ownerInfoBundle;
                          result["responsePass"] = "success";
                          //! Remove the driver's phone number and the car plate number
                          if (
                            result.driverDetails !== undefined &&
                            result.driverDetails.phone_number !== undefined
                          ) {
                            result.driverDetails.phone_number = null;
                            result.driverDetails.plate_number = null;
                            res.send(result);
                          } //No relevant details
                          else {
                            res.send(result);
                          }
                        } //Stange - no ride owner linked to this ride
                        else {
                          res.send({ request_status: "no_rides" });
                        }
                      });
                  } //No rides
                  else {
                    res.send({ request_status: "no_rides" });
                  }
                } //No rides
                else {
                  res.send({ request_status: "no_rides" });
                }
              },
              (error) => {
                console.log(error);
                res.send({ request_status: "no_rides" });
                //console.log(error);
              }
            );
          } //No rides in progress
          else {
            res.send({ request_status: "no_rides" });
          }
        });
    } //Invalid data
    else {
      res.send({ response: "error_invalid_data", flag: false });
    }
  });

  /**
   * SIMULATION
   * Responsible for managing different map or any services simulation scenarios from the simulation tool.
   * Scenarios:
   * 1. MAP
   * -Pickup simulation
   * -Drop off sumlation
   */
  //Origin coords - driver
  //const blon = 17.099327;
  //const blat = -22.579195;
  //const blon = 17.060507;
  //const blat = -22.514987;
  //Destination coords
  //const destinationLat = -22.577673;
  //const destinationLon = 17.086427;

  //1. Pickup simulation
  /*socket.on("startPickupSim", function (req) {
    logToSimulator(socket, "Pickup simulation successfully started.");
    let bundle = {
      driver: { latitude: blat, longitude: blon },
      passenger: {
        latitude: this.state.latitude,
        longitude: this.state.longitude,
      },
      destination: {
        latitude: destinationLat,
        longitude: destinationLon,
      },
    };
  });*/
});
server.listen(process.env.MAP_SERVICE_PORT);
