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
const io = require("socket.io")(server);
const mysql = require("mysql");
const requestAPI = require("request");
//....
var fastFilter = require("fast-filter");
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
const DB_NAME_MONGODB = "Taxiconnect";
const URL_SEARCH_SERVICES = "http://www.taxiconnectna.com:7007/";
//const URL_ROUTE_SERVICES = "http://www.taxiconnectna.com:7008/route?";
const URL_ROUTE_SERVICES = "http://localhost:8383/route?";
//const URL_ROUTE_SERVICES = "localhost:8987/route?";

const clientMongo = new MongoClient(URL_MONGODB, { useUnifiedTopology: true });

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

//--------------DRIVER'S DEBUG DATA-------------------------------------------------------------------
const driverCacheData = {
  user_fingerprint:
    "23c9d088e03653169b9c18193a0b8dd329ea1e43eb0626ef9f16b5b979694a429710561a3cb3ddae",
  latitude: -22.5704962,
  longitude: 17.0809509,
  date_logged: chaineDateUTC,
};
//Cache
//console.log("[1] Initialize debug data in cache");
client.set(
  driverCacheData.user_fingerprint,
  JSON.stringify(driverCacheData),
  redis.print
);
//-----------------------------------------------------------------------------------------------------

const port = 9090;

//Database connection
const dbPool = mysql.createPool({
  connectionLimit: 1000000000,
  host: "localhost",
  database: "taxiconnect",
  user: "root",
  password: "",
});

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
  console.log(passengerPosition);
  let url =
    URL_ROUTE_SERVICES +
    "point=" +
    passengerPosition.latitude +
    "," +
    passengerPosition.longitude +
    "&point=" +
    destinationPosition.latitude +
    "," +
    destinationPosition.longitude +
    "&heading_penalty=0&avoid=residential&avoid=ferry&ch.disable=true&locale=en&details=street_name&details=time&optimize=true&points_encoded=false&details=max_speed&snap_prevention=ferry&profile=car&pass_through=true&instructions=false&vehicle=car";
  requestAPI(url, function (error, response, body) {
    console.log(error, body);
    if (body != undefined) {
      if (body.length > 20) {
        try {
          body = JSON.parse(body);
          if (body.paths[0].distance != undefined) {
            var distance = body.paths[0].distance;
            var eta = body.paths[0].time / 400; //Min
            //Reshape ETA format
            if (eta >= 60) {
              eta = Math.round(eta / 60) + " min away";
            } else {
              eta = Math.round(eta) + " sec away";
            }
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
    URL_ROUTE_SERVICES +
    "point=" +
    driverPosition.latitude +
    "," +
    driverPosition.longitude +
    "&point=" +
    passengerPosition.latitude +
    "," +
    passengerPosition.longitude +
    "&heading_penalty=0&avoid=residential&avoid=ferry&ch.disable=true&locale=en&details=street_name&details=time&optimize=true&points_encoded=false&details=max_speed&snap_prevention=ferry&profile=car&pass_through=true&instructions=false&vehicle=car";

  requestAPI(url, function (error, response, body) {
    if (body != undefined) {
      if (body.length > 20) {
        try {
          body = JSON.parse(body);
          if (body.paths[0].distance != undefined) {
            console.log("HERRRERE-----------");
            var distance = body.paths[0].distance;
            var eta = body.paths[0].time * (3 / 29); //Min
            //Reshape ETA format
            if (eta >= 60) {
              eta = Math.round(eta / 60) + " min away";
            } else {
              eta = Math.round(eta) + " sec away";
            }
            //...
            var rawPoints = body.paths[0].points.coordinates;
            var pointsTravel = rawPoints;
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
                  console.log(result);
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
 * @params mongoCollection, collectionRidersLocation_log, locationData
 * Update the rider's location informations in monogDB everytime a change occurs in the rider's app
 * related to the positioning.
 * Use promises as much as possible.
 */
function updateRidersRealtimeLocationData(
  collectionRidersLocation_log,
  locationData,
  resolve
) {
  resolveDate();
  //Update location log for riders
  new Promise((res) => {
    updateRiderLocationsLog(collectionRidersLocation_log, locationData, res);
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
 * @params  collectionRidersLocation_log, locationData, resolve
 * Responsible for updating any rider location change received.
 * Avoid duplicates as much as possible.
 */
function updateRiderLocationsLog(
  collectionRidersLocation_log,
  locationData,
  resolve
) {
  resolveDate();
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
          date_logged: chaineDateUTC,
        };
        collectionRidersLocation_log.insertOne(dataBundle, function (err, res) {
          resolve(true);
        });
      } else {
        resolve(true);
      }
    });
}

/**
 * @func tripChecker_Dispatcher()
 * inputs:
 * collectionRidersData_repr: rider's front metadata
 * user_fingerprint: fingerprint of the user requesting the information
 * user_nature: rider or driver
 * Responsible for finding out if there is any trip in progress linked to the user fingerprint
 * and dispatch accordingly the information to the correct driver and rider
 * @var isArrivedToDestination
 * @true when the passenger confirms his/her drop off
 * @var isRideCompleted_driverSide
 * @true when the driver confirms that the trip is over from his/her side
 * REQUEST STATUS: pending, inRouteToPickup, inRouteToDropoff, completedDriverConfimed
 */
function tripChecker_Dispatcher(
  collectionRidersData_repr,
  user_fingerprint,
  user_nature,
  resolve
) {
  if (user_nature == "rider") {
    //Check if the user has a pending request
    let rideChecker = {
      client_id: user_fingerprint,
      "ride_state_vars.isRideCompleted_riderSide": false,
    };
    collectionRidersData_repr
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
          //userDataRepr[0].isArrivedToDestination = true; //DEBUG FOR NO RIDES SIMULATION
          //...
          if (
            userDataRepr[0].ride_state_vars.isRideCompleted_riderSide === false
          ) {
            //REQUEST FP
            let request_fp = userDataRepr[0].request_fp;
            //Check if there are any requests cached
            getMongoRecordTrip_cacheLater(
              collectionRidersData_repr,
              user_fingerprint,
              user_nature,
              request_fp,
              resolve
            );
            //console.log(userDataRepr);
          } //No rides recorded
          else {
            //console.log("no rides");
            resolve("no_rides");
          }
        }
      });
  } //Malformed
  else {
    resolve(false);
  }
}

/**
 * @func getRideCachedData_andComputeRoute()
 * Responsible for checking if there are any cached requests for a rider, or get from mongo and launch the computation of the trip details
 * and cache them.
 */

function getUserRideCachedData_andComputeRoute(
  collectionRidersData_repr,
  user_fingerprint,
  user_nature,
  respUser,
  resolve
) {
  //Check if there are any cached user data
  //1. Pre compute and cache next record for later use
  new Promise((reslv) => {
    getMongoRecordTrip_cacheLater(
      collectionRidersData_repr,
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
 * Responsible for getting user record from mongodb, compute route infos, cache it (and cache the user's trip infos for later use).
 * CAN BE USED FOR RIDERS AND DRIVERS
 */
function getMongoRecordTrip_cacheLater(
  collectionRidersData_repr,
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
  collectionRidersData_repr.find(queryFilter).toArray(function (err, result) {
    if (err) {
      resolve(false);
      throw err;
    }
    //Compute route via compute skeleton
    computeRouteDetails_skeleton(result, resolve);
  });
}
/**
 * @func computeRouteDetails_skeleton
 * Compute route details template.
 * MUST convert input into a unique indexed array, eg: [result]
 * CAN BE USED FOR RIDERS AND DRIVERS
 */
function computeRouteDetails_skeleton(result, resolve) {
  if (result.length > 0 && result[0].request_fp !== undefined) {
    //console.log("[Runninf] COMPUTE SKELETON CALLED.");
    //There is a ride
    let rideHistory = result[0];
    let riderCoords = rideHistory.pickup_location_infos.coordinates;
    if (rideHistory.ride_state_vars.isAccepted) {
      console.log("request accepted");
      //Ride pending
      //3 Scenarios:
      //- In route to pickup
      //- In route to drop off
      //- Trip over, confirm drop off rider
      if (
        rideHistory.ride_state_vars.inRideToDestination === false &&
        rideHistory.ride_state_vars.isRideCompleted_driverSide === false
      ) {
        //In route to pickup
        //console.log("In  route to pickup");
        let requestStatusMain = "inRouteToPickup";
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
              //GET DRIVER LOCATION FROM MONGODB
              resolve(false);
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
                      let request0 = new Promise((reslv) => {
                        computeAndCacheRouteDestination(
                          resp,
                          rideHistory,
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
                    let request0 = new Promise((reslv) => {
                      computeAndCacheRouteDestination(
                        resp,
                        rideHistory,
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
                  let request1 = new Promise((reslv) => {
                    computeAndCacheRouteDestination(
                      resp,
                      rideHistory,
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
              //GET DRIVER LOCATION FROM MONGODB
              resolve(false);
            }
          },
          (error) => {
            //console.log(error);
            resolve(false);
          }
        );
      } else if (
        rideHistory.ride_state_vars.isRideCompleted_driverSide === true &&
        rideHistory.ride_state_vars.isArrivedToDestination === false
      ) {
        //Rider's confirmation for the drop off left
        console.log("Riders confirmation of drop off");
        resolve(true);
      } //No action needed
      else {
        resolve(true);
      }
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
        request_status: "pending",
      });
    }
  } //No ride present
  else {
    //console.log("No ride in progress");
    resolve(true);
  }
}

/**
 * ACCEPTED RIDES ONLY
 * @func computeAndCacheRouteDestination()
 * @param rideHistory: contains the infos about the passenger's ride history
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
  riderCoords = false,
  request_status,
  resolve
) {
  //Compute next route update ---------------------------------------------------
  let resp = JSON.parse(driverInfos);
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
      destination: rideHistory.destinationData[0].coordinates,
    };
    console.log(bundle);
  } else if (request_status === "inRouteToDestination") {
    //For to drop off only
    bundle = {
      passenger_origin: {
        latitude: riderCoords.latitude,
        longitude: riderCoords.longitude,
      },
      redisKey: redisKey,
      passenger_destination: rideHistory.destinationData[0].coordinates,
    };
  }

  new Promise((reslv) => {
    getRouteInfos(bundle, reslv);
  }).then(
    (result) => {
      console.log("HEREEE");
      console.log(result);
      //console.log(rideHistory.destinationData);
      //Add request status variable - inRouteToPickup, inRouteToDestination
      result["request_status"] = request_status;
      //Cache computed result
      //Check if the cached trip data is different than the update
      redisGet(rideHistory.request_fp).then(
        (cachedTripData) => {
          if (cachedTripData !== null) {
            if (cachedTripData != JSON.stringify(result)) {
              client.set(
                rideHistory.request_fp,
                JSON.stringify(result),
                redis.print
              );
            }
          } //Update cache anyways
          else {
            //console.log("Update cache");
            client.set(
              rideHistory.request_fp,
              JSON.stringify(result),
              redis.print
            );
          }
        },
        (errorGet) => {
          //console.log("Update cache");
          client.set(
            rideHistory.request_fp,
            JSON.stringify(result),
            redis.print
          );
        }
      );

      //Update driver old trip cached ride history
      redisGet(resp.user_fingerprint).then(
        (res) => {
          if (res !== null) {
            try {
              let prevDriverCache = JSON.parse(res);
              prevDriverCache.rides_history = rideHistory;
              if (res !== JSON.stringify(prevDriverCache)) {
                //console.log("Different data");
                client.set(
                  resp.user_fingerprint,
                  JSON.stringify(prevDriverCache),
                  redis.print
                );
              }
              //Update rider old trip cached ride history
              redisGet(rideHistory.client_id).then(
                (res1) => {
                  if (res !== null) {
                    try {
                      let prevRiderCache = JSON.parse(res1);
                      prevRiderCache.rides_history = rideHistory;
                      if (res !== JSON.stringify(prevRiderCache)) {
                        client.set(
                          rideHistory.client_id,
                          JSON.stringify(prevRiderCache),
                          redis.print
                        );
                      }
                      resolve(true);
                    } catch (error) {
                      resolve(true);
                    }
                  } else {
                    resolve(true);
                  }
                },
                () => {
                  resolve(true);
                }
              );
            } catch (error) {
              resolve(true);
            }
          } else {
            resolve(true);
          }
        },
        () => {
          resolve(true);
        }
      );
      //--------
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
 * @param req: contains all the user informations biased to the location aspect
 * @param resolve: resolver for promise
 * IMPORTANT
 */
function updateRiderLocationInfosCache(req, resolve) {
  resolveDate();
  req.date_logged = chaineDateUTC; //Attach date
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
 * //REDIS propertiy
 * //user_fingerprint -> currentLocationInfos: {...}
 */
function reverseGeocodeUserLocation(resolve, req) {
  //Check if redis has some informations already
  redisGet(req.user_fingerprint).then(
    (resp) => {
      if (resp !== null) {
        //Do a fresh request to update the cache
        //Make a new reseach
        new Promise((res) => {
          //console.log("Fresh geocpding launched");
          reverseGeocoderExec(res, req, JSON.parse(resp));
        }).then(
          (result) => {},
          (error) => {}
        );

        //Has already a cache entry
        //Check if an old current location is present
        resp = JSON.parse(resp);
        if (resp.currentLocationInfos !== undefined) {
          //Present
          //Send
          resolve(resp.currentLocationInfos);
        } //No previously cached current location
        else {
          //Make a new reseach
          new Promise((res) => {
            reverseGeocoderExec(res, req);
          }).then(
            (result) => {
              //Updating cache and replying to the main thread
              let currentLocationEntry = { currentLocationInfos: result };
              client.set(
                req.user_fingerprint.trim(),
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
          reverseGeocoderExec(res, req);
        }).then(
          (result) => {
            //Updating cache and replying to the main thread
            let currentLocationEntry = { currentLocationInfos: result };
            client.set(
              req.user_fingerprint.trim(),
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
 * Responsible for executing the geocoding new fresh requests
 */
function reverseGeocoderExec(resolve, req, updateCache = false) {
  let url =
    URL_SEARCH_SERVICES +
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
              client.set(
                req.user_fingerprint.trim(),
                JSON.stringify(updateCache)
              );
            }
            //...
            resolve(body.features[0].properties);
          } else if (body.features[0].properties.name != undefined) {
            body.features[0].properties.street =
              body.features[0].properties.name;
            if (updateCache !== false) {
              //Update cache
              updateCache.currentLocationInfos = body.features[0].properties;
              client.set(
                req.user_fingerprint.trim(),
                JSON.stringify(updateCache)
              );
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
        console.log(result);
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
 * key: pathToDestinationPreview
 * value: [{...}, {...}]
 */
function findDestinationPathPreview(resolve, pointData) {
  if (pointData.origin !== undefined && pointData.destination !== undefined) {
    //Check from redis first
    redisGet("pathToDestinationPreview").then(
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
        redisGet("pathToDestinationPreview").then(
          (resp) => {
            if (resp !== null) {
              //Contains something
              try {
                //Add new record to the array
                resp = JSON.parse(resp);
                resp.push(result);
                client.set("pathToDestinationPreview", JSON.stringify(resp));
                res(true);
              } catch (error) {
                //Create a fresh one
                client.set(
                  "pathToDestinationPreview",
                  JSON.stringify([result])
                );
                res(false);
              }
            } //No records -create a fresh one
            else {
              client.set("pathToDestinationPreview", JSON.stringify([result]));
              res(true);
            }
          },
          (error) => {
            //create fresh record
            client.set("pathToDestinationPreview", JSON.stringify([result]));
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
          date_updated: chaineDateUTC,
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
            date_updated: chaineDateUTC,
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
 * Responsible for clean the relative distances of drivers and passengers of all false values and
 * limiting the result number based on the @param list_limit parameter
 * @param list_limit: for limiting the result returned or "all" for all the results (not recommended for mobile responses).
 * @param resolve
 */
function cleanAndAdjustRelativeDistancesList(rawList, list_limit = 5, resolve) {
  //Remove any false values
  rawList = rawList.filter(
    (element) => element !== false && element.eta !== false
  );
  //Sort based on the distance
  rawList = rawList.sort((a, b) => a.distance - b.distance);
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
 * MAIN
 */

clientMongo.connect(function (err) {
  //if (err) throw err;
  console.log("[+] MAP services active.");
  const dbMongo = clientMongo.db(DB_NAME_MONGODB);
  const collectionRidersData_repr = dbMongo.collection(
    "rides_deliveries_requests"
  ); //Hold all the requests made (rides and deliveries)
  const collectionRelativeDistances = dbMongo.collection(
    "relative_distances_riders_drivers"
  ); //Hold the relative distances between rider and the drivers (online, same city, same country) at any given time
  const collectionRidersLocation_log = dbMongo.collection(
    "historical_positioning_logs"
  ); //Hold all the location updated from the rider
  const collectionDrivers_profiles = dbMongo.collection("drivers_profiles"); //Hold all the drivers profiles
  //-------------
  const bodyParser = require("body-parser");
  app
    .get("/", function (req, res) {
      res.send("Map services up");
    })
    .use(bodyParser.json())
    .use(bodyParser.urlencoded({ extended: true }));

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
   * PASSENGER LOCATION UPDATE MANAGER
   * Responsible for updating in the databse and other caches new passenger's locations received.
   * Update CACHE -> MONGODB (-> TRIP CHECKER DISPATCHER)
   */
  app.get("/updatePassengerLocation", function (req, res) {
    let params = urlParser.parse(req.url, true);
    //console.log(params.query);
    req = params.query;

    if (
      req !== undefined &&
      req.latitude !== undefined &&
      req.latitude !== null &&
      req.longitude !== undefined &&
      req.longitude !== null &&
      req.user_fingerprint !== null &&
      req.user_fingerprint !== undefined
    ) {
      let timeTaken = new Date();
      timeTaken = timeTaken.getTime();
      //Check for any existing ride
      new Promise((res) => {
        //console.log("fetching data");
        tripChecker_Dispatcher(
          collectionRidersData_repr,
          req.user_fingerprint,
          "rider",
          res
        );
      }).then(
        (result) => {
          let doneTime = new Date();
          timeTaken = doneTime.getTime() - timeTaken;
          //console.log("[" + chaineDateUTC + "] Compute and dispatch time (trip) ------>  " + timeTaken + " ms");
          //Update the rider
          if (result !== false) {
            console.log(result);
            if (result != "no_rides") {
              res.send(result);
              //socket.emit("trackdriverroute-response", result);
            } //No rides
            else {
              res.send({ request_status: result });
              //socket.emit("trackdriverroute-response", { request_status: result });
            }
          }
        },
        (error) => {
          res.send({ response: error });
          //console.log(error);
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
          req,
          resolve2
        );
      }).then(
        () => {
          //console.log("Location updated [rider]");
        },
        () => {}
      );
    }
  });

  /**
   * REVERSE GEOCODER
   * To get the exact approx. location of the user or driver.
   * //REDIS propertiy
   * //user_fingerprint -> currentLocationInfos: {...}
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
   * Responsible for finding out the nature of places (ge. Private locations, taxi ranks or other specific plcaes of interest)
   * This one will only focus on Pvate locations AND taxi ranks.
   * //False means : not a taxirank -> private location AND another object means taxirank
   */
  app.get("/identifyPickupLocation", function (req, res) {
    let params = urlParser.parse(req.url, true);
    //console.log(params.query);
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
      //console.log("Identify pickup location request launch...");
      new Promise((res) => {
        findoutPickupLocationNature(res, req);
      }).then(
        (result) => {
          //console.log(result);
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
        };
        findDestinationPathPreview(res, tmp);
      }).then(
        (result) => {
          console.log("response", result);
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
      //Check the list limit
      if (req.list_limit === undefined) {
        req.list_limit = 7;
      }
      //Get the list of drivers match the availability criteria
      let driverFilter = {
        "operational_state.status": { $regex: /online/i },
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
            driversProfiles = driversProfiles.filter(
              (dData) =>
                dData.operational_state.accepted_requests_infos
                  .total_passengers_number <=
                dData.operational_state.default_selected_car.max_passengers + 3
            );
            //...
            let mainPromiser = driversProfiles.map((driverData) => {
              return new Promise((resolve) => {
                //Check for the coords
                if (
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
                              driverData.push_notification_token; //Add the push notification token
                            resolve(resp[valueIndex]);
                          } //The wanted index is not present, make a new search
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
                                      driver_fingerprint:
                                        driverData.driver_fingerprint,
                                      driver_coordinates: {
                                        latitude:
                                          driverData.operational_state
                                            .last_location.coordinates.latitude,
                                        longitude:
                                          driverData.operational_state
                                            .last_location.coordinates
                                            .longitude,
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
                                  driverData.push_notification_token; //Add push toekn
                                resolve(result);
                              },
                              (error) => {
                                resolve(false);
                              }
                            );
                          }
                        } catch (error) {
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
                                driverData.push_notification_token; //Add push token
                              resolve(result);
                            },
                            (error) => {
                              resolve(false);
                            }
                          );
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
                              driverData.push_notification_token; //Add push notif token
                            resolve(result);
                          },
                          (error) => {
                            resolve(false);
                          }
                        );
                      }
                    },
                    (error) => {
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
                            driverData.push_notification_token; //Add push notif token
                          resolve(result);
                        },
                        (error) => {
                          resolve(false);
                        }
                      );
                    }
                  );
                } else {
                  resolve(false);
                }
              });
            });
            //Resolve all
            Promise.all(mainPromiser).then(
              (result) => {
                //Done- exlude all false
                new Promise((res) => {
                  cleanAndAdjustRelativeDistancesList(
                    result,
                    req.list_limit,
                    res
                  );
                }).then(
                  (reslt) => {
                    //console.log(reslt);
                    res.send(reslt);
                  },
                  (error) => {
                    console.log(error);
                    res.send({ response: "no_close_drivers_found" });
                  }
                );
              },
              (error) => {
                console.log(error);
                res.send(false);
              }
            );
          } //No close drivers
          else {
            res.send({ response: "no_close_drivers_found" });
          }
        });
    } else {
      res.send(false);
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
  const blon = 17.060507;
  const blat = -22.514987;
  //Destination coords
  const destinationLat = -22.577673;
  const destinationLon = 17.086427;

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
server.listen(port);
