require("dotenv").config();
//var dash = require("appmetrics-dash");
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

//EVENT GATEWAY PORT

app
  .get("/", function (req, res) {
    res.send("[+] Events gateway running.");
  })
  .use(express.static(path.join(__dirname, "assets")))
  .use(bodyParser.json())
  .use(bodyParser.urlencoded({ extended: true }));

//EVENTS ROUTER
io.on("connection", (socket) => {
  console.log("Connected to the event gateway.");
  /**
   * MAP SERVICE, port 9090
   * Route: updatePassengerLocation
   * Event: update-passenger-location
   * Update the passenger's location in the system and prefetch the navigation data if any.
   */
  socket.on("update-passenger-location", function (req) {
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
      let url =
        process.env.LOCAL_URL +
        ":" +
        process.env.MAP_SERVICE_PORT +
        "/updatePassengerLocation?latitude=" +
        req.latitude +
        "&longitude=" +
        req.longitude +
        "&user_fingerprint=" +
        req.user_fingerprint;
      //Supplement or not the request string based on if the user is a driver or rider
      if (req.user_nature !== undefined && req.user_nature !== null) {
        url +=
          req.user_nature !== undefined && req.user_nature !== null
            ? "&user_nature=" + req.user_nature
            : "&user_nature=rider";
        url +=
          req.requestType !== undefined && req.requestType !== null
            ? "&requestType=" + req.requestType
            : "&requestType=rides";
      }
      //...
      requestAPI(url, function (error, response, body) {
        console.log("RESPONSE HEREE ", body);
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
    console.log(req);
    if (
      req.latitude !== undefined &&
      req.latitude !== null &&
      req.longitude !== undefined &&
      req.longitude !== null &&
      req.user_fingerprint !== null &&
      req.user_fingerprint !== undefined
    ) {
      let url =
        process.env.LOCAL_URL +
        ":" +
        process.env.MAP_SERVICE_PORT +
        "/getUserLocationInfos?latitude=" +
        req.latitude +
        "&longitude=" +
        req.longitude +
        "&user_fingerprint=" +
        req.user_fingerprint;
      requestAPI(url, function (error, response, body) {
        //console.log(body);
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

    if (
      req.latitude !== undefined &&
      req.latitude !== null &&
      req.longitude !== undefined &&
      req.longitude !== null &&
      req.user_fingerprint !== null &&
      req.user_fingerprint !== undefined
    ) {
      let url =
        process.env.LOCAL_URL +
        ":" +
        process.env.MAP_SERVICE_PORT +
        "/identifyPickupLocation?latitude=" +
        req.latitude +
        "&longitude=" +
        req.longitude +
        "&user_fingerprint=" +
        req.user_fingerprint;
      requestAPI(url, function (error, response, body) {
        //console.log(body);
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
   * MAP SERVICE
   * route name: getRouteToDestinationSnapshot
   * event: getRoute_to_destinationSnapshot
   * params: origin latitude, origin longitude, destination latitude, destination longitude.
   * Responsible for getting the preview of the route to destination after the user enters his/her
   * destination in the app.
   */
  socket.on("getRoute_to_destinationSnapshot", function (req) {
    console.log("Finding route snapshot");
    //console.log(req);

    if (
      req.org_latitude !== undefined &&
      req.org_latitude !== null &&
      req.org_longitude !== undefined &&
      req.org_longitude !== null &&
      req.dest_latitude !== undefined &&
      req.dest_latitude !== null &&
      req.dest_longitude !== undefined &&
      req.dest_longitude !== null &&
      req.user_fingerprint !== null &&
      req.user_fingerprint !== undefined
    ) {
      let url =
        process.env.LOCAL_URL +
        ":" +
        process.env.MAP_SERVICE_PORT +
        "/getRouteToDestinationSnapshot?org_latitude=" +
        req.org_latitude +
        "&org_longitude=" +
        req.org_longitude +
        "&dest_latitude=" +
        req.dest_latitude +
        "&dest_longitude=" +
        req.dest_longitude +
        "&user_fingerprint=" +
        req.user_fingerprint;
      //Add request fingerprint if any
      if (req.request_fp !== undefined && req.request_fp !== null) {
        url += "&request_fp=" + req.request_fp;
      }

      requestAPI(url, function (error, response, body) {
        console.log(body);
        if (error === null) {
          try {
            body = JSON.parse(body);
            socket.emit("getRoute_to_destinationSnapshot-response", body);
          } catch (error) {
            socket.emit("getRoute_to_destinationSnapshot-response", false);
          }
        } else {
          socket.emit("getRoute_to_destinationSnapshot-response", false);
        }
      });
    } //Invalid params
    else {
      socket.emit("getRoute_to_destinationSnapshot-response", false);
    }
  });

  /**
   * MAP SERVICE
   * route name: getVitalsETAOrRouteInfos2points
   * event: get_closest_drivers_to_point
   * params: origin latitude, origin longitude, user fingerprint, city, country, ride type (ride or delivery) and data limit
   * Responsible for getting the list of all the closest drivers to a point (rider) limited by @param list_limit.
   */
  socket.on("get_closest_drivers_to_point", function (req) {
    //console.log("Getting all the closest drivers");
    //console.log(req);
    let list_limit = 7; //Limited to 7 for all clients requests

    if (
      req.org_latitude !== undefined &&
      req.org_latitude !== null &&
      req.org_longitude !== undefined &&
      req.org_longitude !== null &&
      req.city !== undefined &&
      req.city !== null &&
      req.country !== undefined &&
      req.country !== null &&
      req.user_fingerprint !== null &&
      req.user_fingerprint !== undefined &&
      req.ride_type !== null &&
      req.ride_type !== undefined
    ) {
      let url =
        process.env.LOCAL_URL +
        ":" +
        process.env.MAP_SERVICE_PORT +
        "/getVitalsETAOrRouteInfos2points?user_fingerprint=" +
        req.user_fingerprint +
        "&org_latitude=" +
        req.org_latitude +
        "&org_longitude=" +
        req.org_longitude +
        "&ride_type=" +
        req.ride_type +
        "&city=" +
        req.city +
        "&country=" +
        req.country +
        "&list_limit=" +
        list_limit;
      requestAPI(url, function (error, response, body) {
        //console.log(body);
        if (error === null) {
          try {
            body = JSON.parse(body);
            socket.emit("get_closest_drivers_to_point-response", body);
          } catch (error) {
            socket.emit("get_closest_drivers_to_point-response", false);
          }
        } else {
          socket.emit("get_closest_drivers_to_point-response", false);
        }
      });
    } //Invalid params
    else {
      socket.emit("get_closest_drivers_to_point-response", false);
    }
  });

  /**
   * MAP SERVICE
   * route name: getRealtimeTrackingRoute_forTHIS
   * event: getRealtimeTrackingRoute_forTHIS_io
   * params: origin/destination latitude, origin/destination longitude, user fingerprint, request fingerprint
   * Responsible for getting the route infos during a realtime navigation from a point A to a point B.
   */
  socket.on("getRealtimeTrackingRoute_forTHIS_io", function (req) {
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
      let url =
        process.env.LOCAL_URL +
        ":" +
        process.env.MAP_SERVICE_PORT +
        "/getRealtimeTrackingRoute_forTHIS?user_fingerprint=" +
        req.user_fingerprint +
        "&org_latitude=" +
        req.org_latitude +
        "&org_longitude=" +
        req.org_longitude +
        "&dest_latitude=" +
        req.dest_latitude +
        "&dest_longitude=" +
        req.dest_longitude +
        "&request_fp=" +
        req.request_fp;
      requestAPI(url, function (error, response, body) {
        //console.log(body);
        if (error === null) {
          try {
            body = JSON.parse(body);
            socket.emit("getRealtimeTrackingRoute_forTHIS_io-response", body);
          } catch (error) {
            socket.emit("getRealtimeTrackingRoute_forTHIS_io-response", false);
          }
        } else {
          socket.emit("getRealtimeTrackingRoute_forTHIS_io-response", false);
        }
      });
    } //Invalid params
    else {
      socket.emit("getRealtimeTrackingRoute_forTHIS_io-response", false);
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
    if (
      req.user_fp !== undefined &&
      req.user_fp !== null &&
      req.query !== undefined &&
      req.query !== null &&
      req.city !== undefined &&
      req.city !== null
    ) {
      let url =
        process.env.LOCAL_URL +
        ":" +
        process.env.SEARCH_SERVICE_PORT +
        "/getSearchedLocations?user_fp=" +
        req.user_fp +
        "&query=" +
        req.query +
        "&city=" +
        req.city +
        "&country=" +
        req.country;

      requestAPI(url, function (error, response, body) {
        //console.log(body);
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
  socket.on("getPricingForRideorDelivery", function (req) {
    //console.log(req);
    if (
      req.user_fingerprint !== undefined &&
      req.user_fingerprint !== null &&
      req.pickupData !== undefined &&
      req.pickupData !== null &&
      req.naturePickup !== undefined &&
      req.naturePickup !== null &&
      req.destinationData !== undefined &&
      req.destinationData !== null &&
      req.destinationData.passenger1Destination !== undefined &&
      req.destinationData.passenger1Destination !== null
    ) {
      let url =
        process.env.LOCAL_URL +
        ":" +
        process.env.PRICING_SERVICE_PORT +
        "/getOverallPricingAndAvailabilityDetails";

      requestAPI.post({ url, form: req }, function (error, response, body) {
        console.log(body);
        if (error === null) {
          try {
            body = JSON.parse(body);
            if (body.response !== undefined) {
              //Error
              socket.emit("getPricingForRideorDelivery-response", body);
            } //SUCCESS
            else {
              socket.emit("getPricingForRideorDelivery-response", body);
            }
          } catch (error) {
            socket.emit("getPricingForRideorDelivery-response", false);
          }
        } else {
          socket.emit("getPricingForRideorDelivery-response", false);
        }
      });
    } else {
      socket.emit("getPricingForRideorDelivery-response", false);
    }
  });

  /**
   * DISPATCH SERVICE, port 9094
   * Route: dispatchRidesOrDeliveryRequests
   * event: requestRideOrDeliveryForThis
   * Make a ride or delivery request for a rider.
   */
  socket.on("requestRideOrDeliveryForThis", function (req) {
    console.log(req);
    if (req.user_fingerprint !== undefined && req.user_fingerprint !== null) {
      let url =
        process.env.LOCAL_URL +
        ":" +
        process.env.DISPATCH_SERVICE_PORT +
        "/dispatchRidesOrDeliveryRequests";

      requestAPI.post({ url, form: req }, function (error, response, body) {
        console.log(body);
        if (error === null) {
          try {
            body = JSON.parse(body);
            if (body.response !== undefined) {
              //Error
              socket.emit("requestRideOrDeliveryForThis-response", body);
            } //SUCCESS
            else {
              socket.emit("requestRideOrDeliveryForThis-response", body);
            }
          } catch (error) {
            socket.emit("requestRideOrDeliveryForThis-response", false);
          }
        } else {
          socket.emit("requestRideOrDeliveryForThis-response", false);
        }
      });
    } else {
      socket.emit("requestRideOrDeliveryForThis-response", false);
    }
  });

  /**
   * DISPATCH SERVICE, port 9094
   * Route: decline_request
   * event: declineRequest_driver
   * Decline any request from the driver's side.
   */
  socket.on("declineRequest_driver", function (req) {
    console.log(req);
    if (
      req.driver_fingerprint !== undefined &&
      req.driver_fingerprint !== null &&
      req.request_fp !== undefined &&
      req.request_fp !== null
    ) {
      let url =
        process.env.LOCAL_URL +
        ":" +
        process.env.DISPATCH_SERVICE_PORT +
        "/decline_request";

      requestAPI.post({ url, form: req }, function (error, response, body) {
        console.log(body);
        if (error === null) {
          try {
            body = JSON.parse(body);
            socket.emit("declineRequest_driver-response", body);
          } catch (error) {
            socket.emit("declineRequest_driver-response", {
              response: "unable_to_decline_request_error",
            });
          }
        } else {
          socket.emit("declineRequest_driver-response", {
            response: "unable_to_decline_request_error",
          });
        }
      });
    } else {
      socket.emit("declineRequest_driver-response", {
        response: "unable_to_decline_request_error",
      });
    }
  });

  /**
   * DISPATCH SERVICE, port 9094
   * Route: accept_request
   * event: accept_request_io
   * Accept any request from the driver's side.
   */
  socket.on("accept_request_io", function (req) {
    console.log(req);
    if (
      req.driver_fingerprint !== undefined &&
      req.driver_fingerprint !== null &&
      req.request_fp !== undefined &&
      req.request_fp !== null
    ) {
      let url =
        process.env.LOCAL_URL +
        ":" +
        process.env.DISPATCH_SERVICE_PORT +
        "/accept_request";

      requestAPI.post({ url, form: req }, function (error, response, body) {
        console.log(body);
        if (error === null) {
          try {
            body = JSON.parse(body);
            socket.emit("accept_request_io-response", body);
          } catch (error) {
            socket.emit("accept_request_io-response", {
              response: "unable_to_accept_request_error",
            });
          }
        } else {
          socket.emit("accept_request_io-response", {
            response: "unable_to_accept_request_error",
          });
        }
      });
    } else {
      socket.emit("accept_request_io-response", {
        response: "unable_to_accept_request_error",
      });
    }
  });

  /**
   * DISPATCH SERVICE, port 9094
   * Route: cancel_request_driver
   * event: cancel_request_driver_io
   * Cancel any request from the driver's side.
   */
  socket.on("cancel_request_driver_io", function (req) {
    console.log(req);
    if (
      req.driver_fingerprint !== undefined &&
      req.driver_fingerprint !== null &&
      req.request_fp !== undefined &&
      req.request_fp !== null
    ) {
      let url =
        process.env.LOCAL_URL +
        ":" +
        process.env.DISPATCH_SERVICE_PORT +
        "/cancel_request_driver";

      requestAPI.post({ url, form: req }, function (error, response, body) {
        console.log(body);
        if (error === null) {
          try {
            body = JSON.parse(body);
            socket.emit("cancel_request_driver_io-response", body);
          } catch (error) {
            socket.emit("cancel_request_driver_io-response", {
              response: "unable_to_cancel_request_error",
            });
          }
        } else {
          socket.emit("cancel_request_driver_io-response", {
            response: "unable_to_cancel_request_error",
          });
        }
      });
    } else {
      socket.emit("cancel_request_driver_io-response", {
        response: "unable_to_cancel_request_error",
      });
    }
  });

  /**
   * DISPATCH SERVICE, port 9094
   * Route: confirm_pickup_request_driver
   * event: confirm_pickup_request_driver_io
   * Confirm pickup for any request from the driver's side.
   */
  socket.on("confirm_pickup_request_driver_io", function (req) {
    console.log(req);
    if (
      req.driver_fingerprint !== undefined &&
      req.driver_fingerprint !== null &&
      req.request_fp !== undefined &&
      req.request_fp !== null
    ) {
      let url =
        process.env.LOCAL_URL +
        ":" +
        process.env.DISPATCH_SERVICE_PORT +
        "/confirm_pickup_request_driver";

      requestAPI.post({ url, form: req }, function (error, response, body) {
        console.log(body);
        if (error === null) {
          try {
            body = JSON.parse(body);
            socket.emit("confirm_pickup_request_driver_io-response", body);
          } catch (error) {
            socket.emit("confirm_pickup_request_driver_io-response", {
              response: "unable_to_confirm_pickup_request_error",
            });
          }
        } else {
          socket.emit("confirm_pickup_request_driver_io-response", {
            response: "unable_to_confirm_pickup_request_error",
          });
        }
      });
    } else {
      socket.emit("confirm_pickup_request_driver_io-response", {
        response: "unable_to_confirm_pickup_request_error",
      });
    }
  });

  /**
   * DISPATCH SERVICE, port 9094
   * Route: confirm_dropoff_request_driver
   * event: confirm_dropoff_request_driver_io
   * Confirm dropoff for any request from the driver's side.
   */
  socket.on("confirm_dropoff_request_driver_io", function (req) {
    console.log(req);
    if (
      req.driver_fingerprint !== undefined &&
      req.driver_fingerprint !== null &&
      req.request_fp !== undefined &&
      req.request_fp !== null
    ) {
      let url =
        process.env.LOCAL_URL +
        ":" +
        process.env.DISPATCH_SERVICE_PORT +
        "/confirm_dropoff_request_driver";

      requestAPI.post({ url, form: req }, function (error, response, body) {
        console.log(body);
        if (error === null) {
          try {
            body = JSON.parse(body);
            socket.emit("confirm_dropoff_request_driver_io-response", body);
          } catch (error) {
            socket.emit("confirm_dropoff_request_driver_io-response", {
              response: "unable_to_confirm_dropoff_request_error",
            });
          }
        } else {
          socket.emit("confirm_dropoff_request_driver_io-response", {
            response: "unable_to_confirm_dropoff_request_error",
          });
        }
      });
    } else {
      socket.emit("confirm_dropoff_request_driver_io-response", {
        response: "unable_to_confirm_dropoff_request_error",
      });
    }
  });

  /**
   * DISPATCH SERVICE, port 9094
   * Route: confirmRiderDropoff_requests
   * event: confirmRiderDropoff_requests_io
   * Confirm rider's drop off and handle all the related proccesses linked to it.
   */
  socket.on("confirmRiderDropoff_requests_io", function (req) {
    console.log(req);
    if (req.user_fingerprint !== undefined && req.user_fingerprint !== null) {
      let url =
        process.env.LOCAL_URL +
        ":" +
        process.env.DISPATCH_SERVICE_PORT +
        "/confirmRiderDropoff_requests";

      requestAPI.post({ url, form: req }, function (error, response, body) {
        console.log(body);
        if (error === null) {
          try {
            body = JSON.parse(body);
            socket.emit("confirmRiderDropoff_requests_io-response", body);
          } catch (error) {
            socket.emit("confirmRiderDropoff_requests_io-response", {
              response: "error",
            });
          }
        } else {
          socket.emit("confirmRiderDropoff_requests_io-response", {
            response: "error",
          });
        }
      });
    } else {
      socket.emit("confirmRiderDropoff_requests_io-response", {
        response: "error",
      });
    }
  });

  /**
   * DISPATCH SERVICE, port 9094
   * Route: cancelRiders_request
   * event: cancelRiders_request_io
   * Confirm rider's drop off and handle all the related proccesses linked to it.
   */
  socket.on("cancelRiders_request_io", function (req) {
    console.log(req);
    if (req.user_fingerprint !== undefined && req.user_fingerprint !== null) {
      let url =
        process.env.LOCAL_URL +
        ":" +
        process.env.DISPATCH_SERVICE_PORT +
        "/cancelRiders_request";

      requestAPI.post({ url, form: req }, function (error, response, body) {
        console.log(body);
        if (error === null) {
          try {
            body = JSON.parse(body);
            socket.emit("cancelRiders_request_io-response", body);
          } catch (error) {
            socket.emit("cancelRiders_request_io-response", {
              response: "error_cancelling",
            });
          }
        } else {
          socket.emit("cancelRiders_request_io-response", {
            response: "error_cancelling",
          });
        }
      });
    } else {
      socket.emit("cancelRiders_request_io-response", {
        response: "error_cancelling",
      });
    }
  });

  /**
   * ACCOUNTS SERVICE, port 9696
   * Route: sendOTPAndCheckUserStatus
   * event: sendOtpAndCheckerUserStatusTc
   * Verify the phone number by sending an otp and check whether the user is registered or not (status)
   */
  socket.on("sendOtpAndCheckerUserStatusTc", function (req) {
    console.log(req);
    if (req.phone_number !== undefined && req.phone_number !== null) {
      let url =
        process.env.LOCAL_URL +
        ":" +
        process.env.ACCOUNTS_SERVICE_PORT +
        "/sendOTPAndCheckUserStatus?phone_number=" +
        req.phone_number;

      requestAPI(url, function (error, response, body) {
        console.log("ANSWER HERE -> ", body);
        if (error === null) {
          try {
            body = JSON.parse(body);
            socket.emit("sendOtpAndCheckerUserStatusTc-response", body);
          } catch (error) {
            socket.emit("sendOtpAndCheckerUserStatusTc-response", {
              response: "error_checking_user",
            });
          }
        } else {
          socket.emit("sendOtpAndCheckerUserStatusTc-response", {
            response: "error_checking_user",
          });
        }
      });
    } else {
      socket.emit("sendOtpAndCheckerUserStatusTc-response", {
        response: "error_checking_user",
      });
    }
  });

  /**
   * ACCOUNTS SERVICE, port 9696
   * Route: getRiders_walletInfos
   * event: getRiders_walletInfos_io
   * Responsible for computing the wallet summary (total and details) for the riders.
   */
  socket.on("getRiders_walletInfos_io", function (req) {
    console.log(req);
    if (
      req.user_fingerprint !== undefined &&
      req.user_fingerprint !== null &&
      req.mode !== undefined &&
      req.mode !== null
    ) {
      let url =
        process.env.LOCAL_URL +
        ":" +
        process.env.ACCOUNTS_SERVICE_PORT +
        "/getRiders_walletInfos?user_fingerprint=" +
        req.user_fingerprint +
        "&mode=" +
        req.mode;

      requestAPI(url, function (error, response, body) {
        if (error === null) {
          try {
            body = JSON.parse(body);
            socket.emit("getRiders_walletInfos_io-response", body);
          } catch (error) {
            socket.emit("getRiders_walletInfos_io-response", {
              total: 0,
              response: "error",
              tag: "invalid_parameters",
            });
          }
        } else {
          socket.emit("getRiders_walletInfos_io-response", {
            total: 0,
            response: "error",
            tag: "invalid_parameters",
          });
        }
      });
    } else {
      socket.emit("getRiders_walletInfos_io-response", {
        total: 0,
        response: "error",
        tag: "invalid_parameters",
      });
    }
  });

  /**
   * ACCOUNTS SERVICE, port 9696
   * Route: computeDaily_amountMadeSoFar
   * event: computeDaily_amountMadeSoFar_io
   * Responsible for getting the daily amount made so far by the driver for exactly all the completed requests.
   */
  socket.on("computeDaily_amountMadeSoFar_io", function (req) {
    console.log(req);
    if (
      req.driver_fingerprint !== undefined &&
      req.driver_fingerprint !== null
    ) {
      let url =
        process.env.LOCAL_URL +
        ":" +
        process.env.ACCOUNTS_SERVICE_PORT +
        "/computeDaily_amountMadeSoFar?driver_fingerprint=" +
        req.driver_fingerprint;

      requestAPI(url, function (error, response, body) {
        console.log(body);
        if (error === null) {
          try {
            body = JSON.parse(body);
            socket.emit("computeDaily_amountMadeSoFar_io-response", body);
          } catch (error) {
            socket.emit("computeDaily_amountMadeSoFar_io-response", {
              amount: 0,
              currency: "NAD",
              currency_symbol: "N$",
              response: "error",
            });
          }
        } else {
          socket.emit("computeDaily_amountMadeSoFar_io-response", {
            amount: 0,
            currency: "NAD",
            currency_symbol: "N$",
            response: "error",
          });
        }
      });
    } else {
      socket.emit("computeDaily_amountMadeSoFar_io-response", {
        amount: 0,
        currency: "NAD",
        currency_symbol: "N$",
        response: "error",
      });
    }
  });

  /**
   * ACCOUNTS SERVICE, port 9696
   * Route: goOnline_offlineDrivers
   * event: goOnline_offlineDrivers_io
   * Responsible for going online or offline for drivers / or getting the operational status of drivers (online/offline).
   */
  socket.on("goOnline_offlineDrivers_io", function (req) {
    console.log(req);
    if (
      req.driver_fingerprint !== undefined &&
      req.driver_fingerprint !== null &&
      req.action !== undefined &&
      req.action !== null
    ) {
      let url =
        process.env.LOCAL_URL +
        ":" +
        process.env.ACCOUNTS_SERVICE_PORT +
        "/goOnline_offlineDrivers?driver_fingerprint=" +
        req.driver_fingerprint +
        "&action=" +
        req.action;

      //Add the state if found
      if (req.state !== undefined && req.state !== null) {
        url += "&state=" + req.state;
      } else {
        url += "&state=false";
      }

      requestAPI(url, function (error, response, body) {
        console.log(body);
        if (error === null) {
          try {
            body = JSON.parse(body);
            socket.emit("goOnline_offlineDrivers_io-response", body);
          } catch (error) {
            socket.emit("goOnline_offlineDrivers_io-response", {
              response: "error_invalid_request",
            });
          }
        } else {
          socket.emit("goOnline_offlineDrivers_io-response", {
            response: "error_invalid_request",
          });
        }
      });
    } else {
      socket.emit("goOnline_offlineDrivers_io-response", {
        response: "error_invalid_request",
      });
    }
  });

  /**
   * ACCOUNTS SERVICE, port 9696
   * Route: checkSMSOTPTruly
   * event: checkThisOTP_SMS
   * Check that the inputed otp by the user is true (return true, false, or error_checking_otp)
   */
  socket.on("checkThisOTP_SMS", function (req) {
    console.log(req);
    if (
      req.phone_number !== undefined &&
      req.phone_number !== null &&
      req.otp !== undefined &&
      req.otp !== null
    ) {
      let url =
        process.env.LOCAL_URL +
        ":" +
        process.env.ACCOUNTS_SERVICE_PORT +
        "/checkSMSOTPTruly?phone_number=" +
        req.phone_number +
        "&otp=" +
        req.otp;

      requestAPI(url, function (error, response, body) {
        console.log(body);
        if (error === null) {
          try {
            body = JSON.parse(body);
            socket.emit("checkThisOTP_SMS-response", body);
          } catch (error) {
            socket.emit("checkThisOTP_SMS-response", {
              response: "error_checking_otp",
            });
          }
        } else {
          socket.emit("checkThisOTP_SMS-response", {
            response: "error_checking_otp",
          });
        }
      });
    } else {
      socket.emit("checkSMSOTPTruly-response", {
        response: "error_checking_otp",
      });
    }
  });

  /**
   * ACCOUNTS SERVICE, port 9696
   * Route: createMinimalRiderAccount
   * event: createInitialRider_account
   * Create a minimal rider account with only the phone number as crucial param, and return the status
   * of the operation and the user fingerprint if successful.
   */
  socket.on("createInitialRider_account", function (req) {
    console.log(req);
    if (req.phone_number !== undefined && req.phone_number !== null) {
      let url =
        process.env.LOCAL_URL +
        ":" +
        process.env.ACCOUNTS_SERVICE_PORT +
        "/createMinimalRiderAccount?phone_number=" +
        req.phone_number +
        "&pushnotif_token=" +
        (req.pushnotif_token !== undefined && req.pushnotif_token !== null
          ? encodeURIComponent(req.pushnotif_token)
          : false);
      console.log(url);
      requestAPI(url, function (error, response, body) {
        console.log(error, body);
        if (error === null) {
          try {
            body = JSON.parse(body);
            socket.emit("createInitialRider_account-response", body);
          } catch (error) {
            socket.emit("createInitialRider_account-response", {
              response: "error_creating_account",
            });
          }
        } else {
          socket.emit("createInitialRider_account-response", {
            response: "error_creating_account",
          });
        }
      });
    } else {
      socket.emit("createInitialRider_account-response", {
        response: "error_creating_account",
      });
    }
  });
  /**
   * ACCOUNTS SERVICE, port 9696
   * Route: updateAdditionalProfileData_newAccount
   * event: updateAdditionalProfileData
   * Create a minimal rider account with only the phone number as crucial param, and return the status
   * of the operation and the user fingerprint if successful.
   */
  socket.on("updateAdditionalProfileData", function (req) {
    console.log(req);
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
      let url =
        process.env.LOCAL_URL +
        ":" +
        process.env.ACCOUNTS_SERVICE_PORT +
        "/updateAdditionalProfileData_newAccount?name=" +
        req.name +
        "&gender=" +
        req.gender +
        "&email=" +
        req.email +
        "&user_fingerprint=" +
        req.user_fingerprint;
      requestAPI(url, function (error, response, body) {
        console.log(error, body);
        if (error === null) {
          try {
            body = JSON.parse(body);
            socket.emit("updateAdditionalProfileData-response", body);
          } catch (error) {
            socket.emit("updateAdditionalProfileData-response", {
              response: "error_adding_additional_profile_details_new_account",
            });
          }
        } else {
          socket.emit("updateAdditionalProfileData-response", {
            response: "error_adding_additional_profile_details_new_account",
          });
        }
      });
    } else {
      socket.emit("updateAdditionalProfileData-response", {
        response: "error_adding_additional_profile_details_new_account",
      });
    }
  });
  /**
   * ACCOUNTS SERVICE, port 9696
   * Route: getRides_historyRiders
   * event: getRides_historyRiders_batchOrNot
   * Responsible for getting the rides history based on a select type (Past, Scheduledd or Business)
   * or for a targeted one provided a request fingerprint.
   */
  socket.on("getRides_historyRiders_batchOrNot", function (req) {
    console.log(req);
    if (req.user_fingerprint !== undefined && req.user_fingerprint !== null) {
      let url =
        process.env.LOCAL_URL +
        ":" +
        process.env.ACCOUNTS_SERVICE_PORT +
        "/getRides_historyRiders?user_fingerprint=" +
        req.user_fingerprint;
      //Add a ride_type if any
      if (req.ride_type !== undefined && req.ride_type !== null) {
        url += "&ride_type=" + req.ride_type;
      }
      //Add a request fp and targeted flag or any
      if (
        req.target !== undefined &&
        req.target !== null &&
        req.request_fp !== undefined &&
        req.request_fp !== null
      ) {
        //Targeted request (target flags: single, multiple)
        url += "&target=" + req.target + "&request_fp=" + req.request_fp;
      }
      //...
      requestAPI(url, function (error, response, body) {
        console.log(error, body);
        if (error === null) {
          try {
            body = JSON.parse(body);
            socket.emit("getRides_historyRiders_batchOrNot-response", body);
          } catch (error) {
            socket.emit("getRides_historyRiders_batchOrNot-response", {
              response: "error_authentication_failed",
            });
          }
        } else {
          socket.emit("getRides_historyRiders_batchOrNot-response", {
            response: "error_authentication_failed",
          });
        }
      });
    } else {
      socket.emit("getRides_historyRiders_batchOrNot-response", {
        response: "error_authentication_failed",
      });
    }
  });
});

server.listen(process.env.EVENT_GATEWAY_PORT);
//dash.monitor({ server: server });
