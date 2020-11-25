var dash = require("appmetrics-dash");
var express = require("express");
const http = require("http");
const path = require("path");

var app = express();
var server = http.createServer(app);
const io = require("socket.io").listen(server);
const requestAPI = require("request");
const bodyParser = require("body-parser");
//....
var fastFilter = require("fast-filter");

var chaineDateUTC = null;
var dateObject = null;
const moment = require("moment");
const request = require("request");

function resolveDate() {
  //Resolve date
  var date = new Date();
  date = moment(date.getTime()).utcOffset(2);

  dateObject = date;
  date = date.year() + "-" + (date.month() + 1) + "-" + date.date() + " " + date.hour() + ":" + date.minute() + ":" + date.second();
  chaineDateUTC = date;
}
resolveDate();

//Crucial urls
const localURL = "http://localhost";
//EVENT GATEWAY PORT
//const port = 9000;
const port = 9097;

app
  .get("/", function (req, res) {
    res.send("[+] Events gateway running.");
  })
  .use(express.static(path.join(__dirname, "assets")))
  .use(bodyParser.json())
  .use(bodyParser.urlencoded({ extended: true }));

//EVENTS ROUTER
io.sockets.on("connection", function (socket) {
  console.log("Connected to the event gateway.");
  /**
   * MAP SERVICE, port 9090
   * Route: updatePassengerLocation
   * Event: update-passenger-location
   * Update the passenger's location in the system and prefetch the navigation data if any.
   */
  socket.on("update-passenger-location", function (req) {
    let servicePort = 9090;

    if (
      req !== undefined &&
      req.latitude !== undefined &&
      req.latitude !== null &&
      req.longitude !== undefined &&
      req.longitude !== null &&
      req.user_fingerprint !== null &&
      req.user_fingerprint !== undefined
    ) {
      let url =
        localURL +
        ":" +
        servicePort +
        "/updatePassengerLocation?latitude=" +
        req.latitude +
        "&longitude=" +
        req.longitude +
        "&user_fingerprint=" +
        req.user_fingerprint;
      requestAPI(url, function (error, response, body) {
        console.log(body);
        if (error === null) {
          try {
            body = JSON.parse(body);
            socket.emit("trackdriverroute-response", body);
          } catch (error) {
            socket.emit("trackdriverroute-response", false);
          }
        } else {
          socket.emit("trackdriverroute-response", false);
        }
      });
    } //Invalid params
    else {
      socket.emit("trackdriverroute-response", false);
    }
  });

  /**
   * MAP SERVICE
   * Get user location (reverse geocoding)
   */
  socket.on("geocode-this-point", function (req) {
    let servicePort = 9090;

    if (
      req.latitude !== undefined &&
      req.latitude !== null &&
      req.longitude !== undefined &&
      req.longitude !== null &&
      req.user_fingerprint !== null &&
      req.user_fingerprint !== undefined
    ) {
      let url =
        localURL +
        ":" +
        servicePort +
        "/getUserLocationInfos?latitude=" +
        req.latitude +
        "&longitude=" +
        req.longitude +
        "&user_fingerprint=" +
        req.user_fingerprint;
      requestAPI(url, function (error, response, body) {
        console.log(body);
        if (error === null) {
          try {
            body = JSON.parse(body);
            socket.emit("geocode-this-point-response", body);
          } catch (error) {
            socket.emit("geocode-this-point-response", false);
          }
        } else {
          socket.emit("geocode-this-point-response", false);
        }
      });
    } //Invalid params
    else {
      socket.emit("geocode-this-point-response", false);
    }
  });

  /**
   * MAP SERVICE
   * route name: identifyPickupLocation
   * params: latitude, longitude, user_fingerprint
   * Identify pickup location (taxi rank or private location)
   */
  socket.on("getPickupLocationNature", function (req) {
    console.log("identify location...");
    let servicePort = 9090;

    if (
      req.latitude !== undefined &&
      req.latitude !== null &&
      req.longitude !== undefined &&
      req.longitude !== null &&
      req.user_fingerprint !== null &&
      req.user_fingerprint !== undefined
    ) {
      let url =
        localURL +
        ":" +
        servicePort +
        "/identifyPickupLocation?latitude=" +
        req.latitude +
        "&longitude=" +
        req.longitude +
        "&user_fingerprint=" +
        req.user_fingerprint;
      requestAPI(url, function (error, response, body) {
        console.log(body);
        if (error === null) {
          try {
            body = JSON.parse(body);
            socket.emit("getPickupLocationNature-response", body);
          } catch (error) {
            socket.emit("getPickupLocationNature-response", false);
          }
        } else {
          socket.emit("getPickupLocationNature-response", false);
        }
      });
    } //Invalid params
    else {
      socket.emit("getPickupLocationNature-response", false);
    }
  });

  /**
   * SEARCH SERVICE, port 9091
   * Route: getSearchedLocations
   * Event: getSearchedLocations
   * Seached locations autocomplete.
   */
  socket.on("getLocations", function (req) {
    console.log(req);
    let servicePort = 9091;
    if (
      req.user_fp !== undefined &&
      req.user_fp !== null &&
      req.query !== undefined &&
      req.query !== null &&
      req.city !== undefined &&
      req.city !== null
    ) {
      let url = localURL + ":" + servicePort + "/getSearchedLocations?user_fp=" + req.user_fp + "&query=" + req.query + "&city=" + req.city;

      requestAPI(url, function (error, response, body) {
        console.log(body);
        if (error === null) {
          try {
            body = JSON.parse(body);
            socket.emit("getLocations-response", body);
          } catch (error) {
            socket.emit("getLocations-response", false);
          }
        } else {
          socket.emit("getLocations-response", false);
        }
      });
    } else {
      socket.emit("getLocations-response", false);
    }
  });

  /**
   * PRICING SERVICE, port 8989
   * Route: getOverallPricingAndAvailabilityDetails
   * event: getPricingForRideorDelivery
   * Get fare estimations for any ride or delivery booking
   */
  //socket.emit("getPricingForRideorDelivery");
  socket.on("getPricingForRideorDelivery", function (req) {
    let inputData = {
      user_fingerprint: "7c57cb6c9471fd33fd265d5441f253eced2a6307c0207dea57c987035b496e6e8dfa7105b86915da",
      carTypeSelected: "normalTaxiEconomy",
      connectType: "ConnectUs",
      country: "Namibia",
      isAllGoingToSameDestination: true,
      naturePickup: "PrivateLocation",
      passengersNo: 4,
      rideType: "RIDE",
      timeScheduled: "now",
      pickupData: {
        coordinates: [-22.522247, 17.058754],
        location_name: "Maerua mall",
        street_name: "Andromeda Street",
        city: "Windhoek",
      },
      destinationData: {
        passenger1Destination: {
          _id: "5f7de0f1622d1b3e401f9836",
          averageGeo: -11.1096514,
          city: "Windhoek",
          coordinates: [-22.613083449999998, 17.058163390586557],
          country: "Namibia",
          location_id: 359595673,
          location_name: "Health Sciences / UNAM Press (M Block)",
          query: "M",
          state: "Khomas",
          street: "Mandume Ndemufayo Avenue",
        },
        passenger2Destination: false,
        passenger3Destination: false,
        passenger4Destination: false,
      },
    };

    console.log(req);
    let servicePort = 8989;
    /*if (
      req.user_fp !== undefined &&
      req.user_fp !== null &&
      req.query !== undefined &&
      req.query !== null &&
      req.city !== undefined &&
      req.city !== null
    ) {
      let url = localURL + ":" + servicePort + "/getSearchedLocations?user_fp=" + req.user_fp + "&query=" + req.query + "&city=" + req.city;

      requestAPI(url, function (error, response, body) {
        console.log(body);
        if (error === null) {
          try {
            body = JSON.parse(body);
            socket.emit("getLocations-response", body);
          } catch (error) {
            socket.emit("getLocations-response", false);
          }
        } else {
          socket.emit("getLocations-response", false);
        }
      });
    } else {
      socket.emit("getLocations-response", false);
    }*/
  });
});

server.listen(port);
//dash.monitor({ server: server });
