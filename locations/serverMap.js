var express = require("express");
const http = require("http");
const fs = require("fs");

var app = express();
var server = http.createServer(app);
const io = require("socket.io").listen(server);
const mysql = require("mysql");
const requestAPI = require("request");
//....
var fastFilter = require("fast-filter");
const { promisify, inspect } = require("util");
var chaineDateUTC = null;
var dateObject = null;
const moment = require("moment");
const e = require("express");

const URL_SEARCH_SERVICES = "http://www.taxiconnectna.com:7007/";
const URL_ROUTE_SERVICES = "http://www.taxiconnectna.com:7008/route?";

function resolveDate() {
  //Resolve date
  var date = new Date();
  date = moment(date.getTime()).utcOffset(2);

  dateObject = date;
  date = date.year() + "-" + (date.month() + 1) + "-" + date.date() + " " + date.hour() + ":" + date.minute() + ":" + date.second();
  chaineDateUTC = date;
}
resolveDate();

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

function getRouteInfos(coordsInfos, resolve) {
  /**
   * Get the route details for all the case scenarios
   * Scenarios: Route to pickup, route to destination
   * routeInfos is present to distinuish between pickup route requests, destinations route request or other scenarios
   */
  let driverPosition = coordsInfos.driver;
  let passengerPosition = coordsInfos.passenger; //CAREFULL COULD BE THE PASSENGER'S PICKUP LOCATION OF DESTINATION (ref. to the app code)
  let destinationPosition = false;
  if (coordsInfos.destination !== undefined) {
    destinationPosition = coordsInfos.destination;
  }

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
                (error) => {
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
                destinationData: "routeTracking",
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

dbPool.getConnection(function (err, connection) {
  //Cached restore OR initialized
  const bodyParser = require("body-parser");
  app.get("/", function (req, res) {
    res.sendFile(__dirname + "/tripSimulator.html");
  });
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
      if (coordsData !== undefined && coordsData != null && coordsData.driver.latitude !== undefined && coordsData.passenger.latitude !== undefined) {
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
      if (coordsData !== undefined && coordsData != null && coordsData.driver.latitude !== undefined && coordsData.passenger.latitude !== undefined) {
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
  });
});

server.listen(port);
