var dash = require("appmetrics-dash");
var express = require("express");
const http = require("http");
const fs = require("fs");
const path = require("path");
const MongoClient = require("mongodb").MongoClient;

var app = express();
var server = http.createServer(app);
const io = require("socket.io").listen(server);
const mysql = require("mysql");
const requestAPI = require("request");
//....
var fastFilter = require("fast-filter");
const { promisify, inspect } = require("util");
const redis = require("redis");
const client = redis.createClient();
const redisGet = promisify(client.get).bind(client);

var chaineDateUTC = null;
var dateObject = null;
const moment = require("moment");
const e = require("express");

const URL_MONGODB = "mongodb://localhost:27017";
const DB_NAME_MONGODB = "riders_data_schemeless";
const URL_SEARCH_SERVICES = "http://www.taxiconnectna.com:7007/";
const URL_ROUTE_SERVICES = "http://www.taxiconnectna.com:7008/route?";

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

//--------------DRIVER'S DEBUG DATA-------------------------------------------------------------------
const driverCacheData = {
  user_fingerprint: "23c9d088e03653169b9c18193a0b8dd329ea1e43eb0626ef9f16b5b979694a429710561a3cb3ddae",
  latitude: -22.514987,
  longitude: 17.060507,
  date_logged: chaineDateUTC,
};
//Cache
console.log("[1] Initialize debug data in cache");
client.set(driverCacheData.user_fingerprint, JSON.stringify(driverCacheData), redis.print);
//-----------------------------------------------------------------------------------------------------

const port = 9000;

//Database connection
const dbPool = mysql.createPool({
  connectionLimit: 1000000000,
  host: "localhost",
  database: "taxiconnect",
  user: "root",
  password: "",
});

function logObject(obj) {
  console.log(inspect(obj, { maxArrayLength: null, depth: null, showHidden: true, colors: true }));
}

function logToSimulator(socket, data) {
  socket.emit("updateTripLog", { logText: data });
}

function getRouteInfosDestination(coordsInfos, resolve) {
  let destinationPosition = coordsInfos.destination;
  let passengerPosition = coordsInfos.passenger;

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
    "&heading_penalty=0&avoid=residential&avoid=ferry&ch.disable=true&locale=en&details=street_name&details=time&optimize=true&points_encoded=false&details=max_speed&snap_prevention=ferry&profile=car&pass_through=true&instructions=false";
  requestAPI(url, function (error, response, body) {
    //console.log(error, response, body);
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
            var rawPoints = body.paths[0].points.coordinates;
            var pointsTravel = rawPoints;
            //=====================================================================
            resolve({
              routePoints: pointsTravel,
              driverNextPoint: pointsTravel[0],
              destinationPoint: [destinationPosition.longitude, destinationPosition.latitude],
              eta: eta,
              distance: distance,
            });
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
  let driverPosition = coordsInfos.driver === undefined ? coordsInfos.passenger_origin : coordsInfos.driver; //CAREFUL COULD BE THE PASSENGER'S ORIGIN POINT, especially useful when a request is still pending.
  let passengerPosition = coordsInfos.passenger === undefined ? coordsInfos.passenger_destination : coordsInfos.passenger; //CAREFUL COULD BE THE PASSENGER'S PICKUP LOCATION OF DESTINATION (ref. to the app code).
  let destinationPosition = coordsInfos.passenger_destination === undefined ? false : coordsInfos.destination; //Deactive when a request is still in progress as the destination information is already contained in @var passenger_destination.
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
    "&heading_penalty=0&avoid=residential&avoid=ferry&ch.disable=true&locale=en&details=street_name&details=time&optimize=true&points_encoded=false&details=max_speed&snap_prevention=ferry&profile=car&pass_through=true&instructions=false";

  requestAPI(url, function (error, response, body) {
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
            var rawPoints = body.paths[0].points.coordinates;
            var pointsTravel = rawPoints;
            //=====================================================================
            //Get destination's route infos
            if (destinationPosition !== false) {
              let request0 = new Promise((res) => {
                let bundleData = {
                  passenger: passengerPosition,
                  destination: destinationPosition,
                };
                getRouteInfosDestination(bundleData, res);
              }).then(
                (result) => {
                  if (result !== false && result !== undefined && result != null) {
                    resolve({
                      routePoints: pointsTravel,
                      destinationData: result,
                      driverNextPoint: pointsTravel[0],
                      eta: eta,
                      distance: distance,
                    });
                  } else {
                    resolve({
                      routePoints: pointsTravel,
                      destinationData: null,
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
                    driverNextPoint: pointsTravel[0],
                    eta: eta,
                    distance: distance,
                  });
                }
              );
            } else {
              resolve({
                routePoints: pointsTravel,
                destinationData: coordsInfos.passenger_destination === undefined ? "routeTracking" : "requestToDestinationTracking_pending", //Check whether the request is still pending (requestToDest...) or is accepted and is in progress (routeTracking)
                driverNextPoint: pointsTravel[0],
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
function updateRidersRealtimeLocationData(collectionRidersData_repr, collectionRidersLocation_log, locationData, resolve) {
  resolveDate();
  //Update location log for riders
  let request0 = new Promise((res) => {
    updateRiderLocationsLog(collectionRidersLocation_log, locationData, res);
  }).then(
    () => {},
    () => {}
  );
  //Check if the rider has already a record
  collectionRidersData_repr.find({ user_fingerprint: locationData.user_fingerprint }).toArray(function (err, result) {
    if (err) {
      resolve(false);
      throw err;
    }
    //...
    if (result.length > 0) {
      //Has a record - update one
      let dataFilter = { user_fingerprint: locationData.user_fingerprint };
      let updatedDataBundle = {
        $set: { coordinates: { latitude: locationData.latitude, longitude: locationData.longitude }, date_logged: chaineDateUTC },
      };
      collectionRidersData_repr.updateOne(dataFilter, updatedDataBundle, function (err, res) {
        resolve(true);
      });
    } //No records - create one
    else {
      let dataBundle = {
        user_fingerprint: locationData.user_fingerprint,
        coordinates: { latitude: locationData.latitude, longitude: locationData.longitude },
        date_logged: chaineDateUTC,
      };
      collectionRidersData_repr.insertOne(dataBundle, function (err, res) {
        resolve(true);
      });
    }
  });
}

/**
 * @func updateRiderLocationsLog()
 * @params  collectionRidersLocation_log, locationData, resolve
 * Responsible for updating any rider location change received.
 * Avoid duplicates as much as possible.
 */
function updateRiderLocationsLog(collectionRidersLocation_log, locationData, resolve) {
  resolveDate();
  //Check if new
  collectionRidersLocation_log
    .find({ user_fingerprint: locationData.user_fingerprint, coordinates: { latitude: locationData.latitude, longitude: locationData.longitude } })
    .toArray(function (err, res) {
      if (res.length == 0) {
        //New record
        let dataBundle = {
          user_fingerprint: locationData.user_fingerprint,
          coordinates: { latitude: locationData.latitude, longitude: locationData.longitude },
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
function tripChecker_Dispatcher(collectionRidersData_repr, user_fingerprint, user_nature, resolve) {
  if (user_nature == "rider") {
    //Check if there are any requests in MongoDB
    let queryFilter = {
      user_fingerprint: user_fingerprint,
    };
    collectionRidersData_repr.find(queryFilter).toArray(function (err, result) {
      if (err) {
        resolve(false);
        throw err;
      }

      if (result.length > 0) {
        //There is a ride
        let rideHistory = result[0].rides_history;
        if (rideHistory.isAccepted) {
          //Ride pending
          //3 Scenarios:
          //- In route to pickup
          //- In route to drop off
          //- Trip over, confirm drop off rider
          if (rideHistory.inRideToDestination === false && rideHistory.isRideCompleted_driverSide === false) {
            //In route to pickup
            console.log("In  route to pickup");
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
                          let tripData = JSON.parse(resp0);
                          //Found a precomputed record
                          console.log("Trip data cached found!");
                          resolve(tripData);
                        } catch (error) {
                          console.log(error);
                          resolve(false);
                        }
                      } //no record create a new one
                      else {
                        //Compute next route update ---------------------------------------------------
                        let request0 = new Promise((reslv) => {
                          computeAndCacheRouteDestination(resp, rideHistory, reslv);
                        }).then(
                          () => {
                            //Get route infos from cache.
                            redisGet(rideHistory.request_fp).then(
                              (result) => {
                                resolve(result);
                              },
                              (error) => {
                                console.log(error);
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
                      console.log(err0);
                      //Compute next route update ---------------------------------------------------
                      let request1 = new Promise((reslv) => {
                        computeAndCacheRouteDestination(resp, rideHistory, reslv);
                      }).then(
                        () => {
                          //Get route infos from cache.
                          redisGet(rideHistory.request_fp).then(
                            (result) => {
                              resolve(result);
                            },
                            (error) => {
                              console.log(error);
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
                console.log(error);
                resolve(false);
              }
            );
          } else if (rideHistory.inRideToDestination === true && rideHistory.isRideCompleted_driverSide === false) {
            //In route to drop off
            console.log("In route to drop off");
            resolve(true);
          } else if (rideHistory.isRideCompleted_driverSide === true && rideHistory.isArrivedToDestination === false) {
            //Rider's confirmation for the drop off left
            console.log("Riders confirmation of drop off");
            resolve(true);
          } //No action needed
          else {
            resolve(true);
          }
        } //Request pending
        else {
          console.log("request pending...");
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
              console.log(error);
              resolve(false);
            }
          );*/
          //Add request status variable - pending
          resolve({
            pickupLocation_name: rideHistory.rider_pickupLocation.locationName,
            pickupLocation_point: [rideHistory.rider_pickupLocation.point.longitude, rideHistory.rider_pickupLocation.point.latitude],
            request_status: "pending",
          });
        }
      } //No ride present
      else {
        console.log("No ride in progress");
        resolve(true);
      }
    });
  } //Malformed
  else {
    resolve(false);
  }
}

/**
 * ACCEPTED RIDES ONLY
 * @func computeAndCacheRouteDestination()
 * @params rideHistory: contains the infos about the passenger's ride history
 * @parms driverInfos: contains the infos of the associated driver from cache or mongo IN TEXT FROM - Use JSON.parse to make a useful object.
 * @parms resolve: resover for the promise.
 * Responsible for finding all the trip information for a sepcific ride and cache it for later and efficient use.
 * Promisify!
 */
function computeAndCacheRouteDestination(driverInfos, rideHistory, resolve) {
  //Compute next route update ---------------------------------------------------
  driverInfos = JSON.parse(driverInfos);
  let bundle = {
    driver: {
      latitude: resp.latitude,
      longitude: resp.longitude,
    },
    passenger: {
      latitude: rideHistory.rider_destination.destination1.point.latitude,
      longitude: rideHistory.rider_destination.destination1.point.longitude,
    },
  };

  let request0 = new Promise((reslv) => {
    getRouteInfos(bundle, reslv);
  }).then(
    (result) => {
      //Add request status variable - inRouteToPickup
      result["request_status"] = "inRouteToPickup";
      //Cache computed result
      client.set(rideHistory.request_fp, JSON.stringify(result));
      //--------
      resolve(true);
    },
    (error) => {
      console.log(error);
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
          console.log("updating existing cache...");
          let prevCache = JSON.parse(resp);
          //Update the previous cache
          prevCache.latitude = req.latitude;
          prevCache.longitude = req.longitude;
          prevCache.date_logged = req.date_logged; //Updated cache data
          client.set(req.user_fingerprint.trim(), JSON.stringify(prevCache), redis.print);
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
 * MAIN
 */

dbPool.getConnection(function (err, connection) {
  clientMongo.connect(function (err) {
    //if (err) throw err;
    console.log("Connected to Mongodb");
    const dbMongo = clientMongo.db(DB_NAME_MONGODB);
    const collectionRidersData_repr = dbMongo.collection("riders_data_representation"); //Hold the latest location update from the rider
    const collectionRidersLocation_log = dbMongo.collection("riders_data_location_log"); //Hold all the location updated from the rider
    //-------------
    const bodyParser = require("body-parser");
    app.get("/", function (req, res) {
      res.sendFile(__dirname + "/tripSimulator.html");
    });
    app.use(express.static(path.join(__dirname, "assets")));
    // support parsing of application/json type post data
    app.use(bodyParser.json());
    //support parsing of application/x-www-form-urlencoded post data
    app.use(bodyParser.urlencoded({ extended: true }));

    io.sockets.on("connection", function (socket) {
      console.log("client connected");

      //Ride tracking for customers to see real-time drivers positions
      socket.on("trackdriverroute", function (coordsData) {
        console.log(coordsData);
        logToSimulator(socket, coordsData);
        if (
          coordsData !== undefined &&
          coordsData != null &&
          coordsData.driver.latitude !== undefined &&
          coordsData.passenger.latitude !== undefined
        ) {
          let request0 = new Promise((resolve) => {
            getRouteInfos(coordsData, resolve);
          }).then(
            (result) => {
              console.log(result);
              logToSimulator(socket, result);
              socket.emit("trackdriverroute-response", result);
            },
            (error) => {
              console.log(error);
              logToSimulator(socket, error);
              socket.emit("trackdriverroute-response", { response: false });
            }
          );
        } else {
          socket.emit("trackdriverroute-response", { response: false });
        }
      });

      //Get itinary informations for ride - passengers
      socket.on("getIteinerayDestinationInfos", function (coordsData) {
        console.log(coordsData);
        if (
          coordsData !== undefined &&
          coordsData != null &&
          coordsData.driver.latitude !== undefined &&
          coordsData.passenger.latitude !== undefined
        ) {
          let request0 = new Promise((resolve) => {
            getRouteInfos(coordsData, resolve);
          }).then(
            (result) => {
              //console.log(result);
              socket.emit("getIteinerayDestinationInfos-response", result);
            },
            (error) => {
              console.log(error);
              socket.emit("getIteinerayDestinationInfos-response", { response: false });
            }
          );
        } else {
          socket.emit("getIteinerayDestinationInfos-response", { response: false });
        }
      });

      /**
       * PASSENGER LOCATION UPDATE MANAGER
       * Responsible for updating in the databse and other caches new passenger's locations received.
       * Update CACHE -> MONGODB (-> TRIP CHECKER DISPATCHER)
       */
      socket.on("update-passenger-location", function (req) {
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
          let request0 = new Promise((res) => {
            tripChecker_Dispatcher(collectionRidersData_repr, req.user_fingerprint, "rider", res);
          }).then(
            (result) => {
              let doneTime = new Date();
              timeTaken = doneTime.getTime() - timeTaken;
              console.log("[" + chaineDateUTC + "] Compute and dispatch time (trip) ------>  " + timeTaken + " ms");
              //console.log(result);
              //Update the rider
              socket.emit("trackdriverroute-response", result);
            },
            (error) => {
              console.log(error);
            }
          );

          //Update cache for this user's location
          let request1 = new Promise((resolve) => {
            updateRiderLocationInfosCache(req, resolve);
          }).then(
            () => {},
            () => {}
          );

          //Update rider's location - promise always
          let request2 = new Promise((resolve) => {
            updateRidersRealtimeLocationData(collectionRidersData_repr, collectionRidersLocation_log, req, resolve);
          }).then(
            () => {
              console.log("Location updated [rider]");
            },
            () => {}
          );
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
      socket.on("startPickupSim", function (req) {
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
      });
    });
  });
});

server.listen(port);
dash.monitor({ server: server });
