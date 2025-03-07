require("dotenv").config();
//require("newrelic");
var express = require("express");
const http = require("http");
const path = require("path");
var multer = require("multer");
const morgan = require("morgan");

const { logger } = require("./LogService");

var app = express();
var server = http.createServer(app);
var cors = require("cors");
var helmet = require("helmet");
const io = require("socket.io")(server, {
  cors: {
    origin: /production/i.test(process.env.EVIRONMENT)
      ? process.env.LEAD_DOMAIN_URL
      : `http://${process.env.INSTANCE_PRIVATE_IP}`,
    methods: ["GET", "POST"],
    credentials: true,
  },
});
const requestAPI = require("request");
//....

var chaineDateUTC = null;
var dateObject = null;
const moment = require("moment");

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

//EVENT GATEWAY PORT
app.use(morgan("dev"));

app
  .get("/", function (req, res) {
    res.send("[+] Events gateway running (2.0.388).");
  })
  .use(express.static(path.join(__dirname, "assets")));
app
  .use(
    express.json({
      limit: process.env.MAX_DATA_BANDWIDTH_EXPRESS,
      extended: true,
    })
  )
  .use(
    express.urlencoded({
      limit: process.env.MAX_DATA_BANDWIDTH_EXPRESS,
      extended: true,
    })
  )
  // .use(multer().none())
  .use(cors())
  .use(helmet());

//? REST equivalent for common websockets.
/**
 * For the courier driver resgistration
 */
app.post("/registerCourier_ppline", function (req, res) {
  logger.info(String(req.body).length);
  let url =
    `${
      /production/i.test(process.env.EVIRONMENT)
        ? `http://${process.env.INSTANCE_PRIVATE_IP}`
        : process.env.LOCAL_URL
    }` +
    ":" +
    process.env.ACCOUNTS_SERVICE_PORT +
    "/processCourierDrivers_application";

  requestAPI.post({ url, form: req.body }, function (error, response, body) {
    logger.info(url);
    logger.info(body, error);
    if (error === null) {
      try {
        body = JSON.parse(body);
        res.send(body);
      } catch (error) {
        res.send({ response: "error" });
      }
    } else {
      res.send({ response: "error" });
    }
  });
});

/**
 * For the rides driver registration
 */

app.post("/registerDriver_ppline", function (req, res) {
  logger.info(String(req.body).length);
  let url =
    `${
      /production/i.test(process.env.EVIRONMENT)
        ? `http://${process.env.INSTANCE_PRIVATE_IP}`
        : process.env.LOCAL_URL
    }` +
    ":" +
    process.env.ACCOUNTS_SERVICE_PORT +
    "/processRidesDrivers_application";

  requestAPI.post({ url, form: req.body }, function (error, response, body) {
    logger.info(url);
    logger.info(body, error);
    if (error === null) {
      try {
        body = JSON.parse(body);
        res.send(body);
      } catch (error) {
        res.send({ response: "error" });
      }
    } else {
      res.send({ response: "error" });
    }
  });
});

app.post("/update_requestsGraph", function (req, res) {
  logger.info(req);
  req = req.body;

  if (req.driver_fingerprint !== undefined && req.driver_fingerprint !== null) {
    let url =
      `${
        /production/i.test(process.env.EVIRONMENT)
          ? `http://${process.env.INSTANCE_PRIVATE_IP}`
          : process.env.LOCAL_URL
      }` +
      ":" +
      process.env.DISPATCH_SERVICE_PORT +
      "/getRequests_graphNumbers?driver_fingerprint=" +
      req.driver_fingerprint;

    requestAPI(url, function (error, response, body) {
      //logger.info(body);
      if (error === null) {
        try {
          body = JSON.parse(body);
          res.send(body);
        } catch (error) {
          res.send({
            rides: 0,
            deliveries: 0,
            scheduled: 0,
          });
        }
      } else {
        res.send({
          rides: 0,
          deliveries: 0,
          scheduled: 0,
        });
      }
    });
  } else {
    res.send({
      rides: 0,
      deliveries: 0,
      scheduled: 0,
    });
  }
});

//?2
/**
 * MAP SERVICE
 * Get user location (reverse geocoding)
 */
app.post("/geocode_this_point", function (req, res) {
  req = req.body;

  if (
    req.latitude !== undefined &&
    req.latitude !== null &&
    req.longitude !== undefined &&
    req.longitude !== null &&
    req.user_fingerprint !== null &&
    req.user_fingerprint !== undefined
  ) {
    let url =
      `${
        /production/i.test(process.env.EVIRONMENT)
          ? `http://${process.env.INSTANCE_PRIVATE_IP}`
          : process.env.LOCAL_URL
      }` +
      ":" +
      process.env.MAP_SERVICE_PORT +
      "/getUserLocationInfos";

    requestAPI.post({ url, form: req }, function (error, response, body) {
      logger.info(url);
      logger.info(body, error);
      if (error === null) {
        try {
          body = JSON.parse(body);
          res.send(body);
        } catch (error) {
          res.send(false);
        }
      } else {
        res.send(false);
      }
    });
  } //Invalid params
  else {
    res.send(false);
  }
});

/**
 * MAP SERVICE, port 9090
 * Route: updatePassengerLocation
 * Event: update-passenger-location
 * Update the passenger's location in the system and prefetch the navigation data if any.
 */
app.post("/update_passenger_location", function (req, res) {
  req = req.body;

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
      `${
        /production/i.test(process.env.EVIRONMENT)
          ? `http://${process.env.INSTANCE_PRIVATE_IP}`
          : process.env.LOCAL_URL
      }` +
      ":" +
      process.env.MAP_SERVICE_PORT +
      "/updatePassengerLocation";
    //Supplement or not the request string based on if the user is a driver or rider
    if (req.user_nature !== undefined && req.user_nature !== null) {
      req.user_nature =
        req.user_nature !== undefined && req.user_nature !== null
          ? req.user_nature
          : "rider";
      req.requestType =
        req.requestType !== undefined && req.requestType !== null
          ? req.requestType
          : "rides";
    }
    //...

    requestAPI.post({ url, form: req }, function (error, response, body) {
      if (error === null) {
        try {
          body = JSON.parse(body);
          //logger.info(body);
          res.send(body);
        } catch (error) {
          res.send(false);
        }
      } else {
        res.send(false);
      }
    });
  } //Invalid params
  else {
    res.send(false);
  }
});

/**
 * DISPATCH SERVICE, port 9094
 * Route: accept_request
 * event: accept_request_io
 * Accept any request from the driver's side.
 */
app.post("/accept_request_io", function (req, res) {
  //logger.info(req);
  req = req.body;
  if (
    req.driver_fingerprint !== undefined &&
    req.driver_fingerprint !== null &&
    req.request_fp !== undefined &&
    req.request_fp !== null
  ) {
    let url =
      `${
        /production/i.test(process.env.EVIRONMENT)
          ? `http://${process.env.INSTANCE_PRIVATE_IP}`
          : process.env.LOCAL_URL
      }` +
      ":" +
      process.env.DISPATCH_SERVICE_PORT +
      "/accept_request";

    requestAPI.post({ url, form: req }, function (error, response, body) {
      //logger.info(body);
      if (error === null) {
        try {
          body = JSON.parse(body);
          res.send(body);
        } catch (error) {
          res.send({
            response: "unable_to_accept_request_error",
          });
        }
      } else {
        res.send({
          response: "unable_to_accept_request_error",
        });
      }
    });
  } else {
    res.send({
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
app.post("/cancel_request_driver_io", function (req, res) {
  req = req.body;
  //logger.info(req);
  if (
    req.driver_fingerprint !== undefined &&
    req.driver_fingerprint !== null &&
    req.request_fp !== undefined &&
    req.request_fp !== null
  ) {
    let url =
      `${
        /production/i.test(process.env.EVIRONMENT)
          ? `http://${process.env.INSTANCE_PRIVATE_IP}`
          : process.env.LOCAL_URL
      }` +
      ":" +
      process.env.DISPATCH_SERVICE_PORT +
      "/cancel_request_driver";

    requestAPI.post({ url, form: req }, function (error, response, body) {
      //logger.info(body);
      if (error === null) {
        try {
          body = JSON.parse(body);
          res.send(body);
        } catch (error) {
          res.send({
            response: "unable_to_cancel_request_error",
          });
        }
      } else {
        res.send({
          response: "unable_to_cancel_request_error",
        });
      }
    });
  } else {
    res.send({
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
app.post("/confirm_pickup_request_driver_io", function (req, res) {
  //logger.info(req);
  req = req.body;

  if (
    req.driver_fingerprint !== undefined &&
    req.driver_fingerprint !== null &&
    req.request_fp !== undefined &&
    req.request_fp !== null
  ) {
    let url =
      `${
        /production/i.test(process.env.EVIRONMENT)
          ? `http://${process.env.INSTANCE_PRIVATE_IP}`
          : process.env.LOCAL_URL
      }` +
      ":" +
      process.env.DISPATCH_SERVICE_PORT +
      "/confirm_pickup_request_driver";

    requestAPI.post({ url, form: req }, function (error, response, body) {
      //logger.info(body);
      if (error === null) {
        try {
          body = JSON.parse(body);
          res.send(body);
        } catch (error) {
          res.send({
            response: "unable_to_confirm_pickup_request_error",
          });
        }
      } else {
        res.send({
          response: "unable_to_confirm_pickup_request_error",
        });
      }
    });
  } else {
    res.send({
      response: "unable_to_confirm_pickup_request_error",
    });
  }
});

/**
 * DISPATCH SERVICE, port 9094
 * Route: decline_request
 * event: declineRequest_driver
 * Decline any request from the driver's side.
 */
app.post("/declineRequest_driver", function (req, res) {
  //logger.info(req);
  req = req.body;
  if (
    req.driver_fingerprint !== undefined &&
    req.driver_fingerprint !== null &&
    req.request_fp !== undefined &&
    req.request_fp !== null
  ) {
    let url =
      `${
        /production/i.test(process.env.EVIRONMENT)
          ? `http://${process.env.INSTANCE_PRIVATE_IP}`
          : process.env.LOCAL_URL
      }` +
      ":" +
      process.env.DISPATCH_SERVICE_PORT +
      "/decline_request";

    requestAPI.post({ url, form: req }, function (error, response, body) {
      //logger.info(body);
      if (error === null) {
        try {
          body = JSON.parse(body);
          res.send(body);
        } catch (error) {
          res.send({
            response: "unable_to_decline_request_error",
          });
        }
      } else {
        res.send({
          response: "unable_to_decline_request_error",
        });
      }
    });
  } else {
    res.send({
      response: "unable_to_decline_request_error",
    });
  }
});

/**
 * DISPATCH SERVICE, port 9094
 * Route: confirm_dropoff_request_driver
 * event: confirm_dropoff_request_driver_io
 * Confirm dropoff for any request from the driver's side.
 */
app.post("/confirm_dropoff_request_driver_io", function (req, res) {
  //logger.info(req);
  req = req.body;
  if (
    req.driver_fingerprint !== undefined &&
    req.driver_fingerprint !== null &&
    req.request_fp !== undefined &&
    req.request_fp !== null
  ) {
    let url =
      `${
        /production/i.test(process.env.EVIRONMENT)
          ? `http://${process.env.INSTANCE_PRIVATE_IP}`
          : process.env.LOCAL_URL
      }` +
      ":" +
      process.env.DISPATCH_SERVICE_PORT +
      "/confirm_dropoff_request_driver";

    requestAPI.post({ url, form: req }, function (error, response, body) {
      //logger.info(body);
      if (error === null) {
        try {
          body = JSON.parse(body);
          res.send(body);
        } catch (error) {
          res.send({
            response: "unable_to_confirm_dropoff_request_error",
          });
        }
      } else {
        res.send({
          response: "unable_to_confirm_dropoff_request_error",
        });
      }
    });
  } else {
    res.send({
      response: "unable_to_confirm_dropoff_request_error",
    });
  }
});

/**
 * DISPATCH SERVICE, port 9094
 * Route: getRequests_graphNumbers
 * event: update_requestsGraph
 * Update the general requests numbers for ease of access
 */
app.post("/update_requestsGraph", function (req, res) {
  //logger.info(req);
  req = req.body;
  if (req.driver_fingerprint !== undefined && req.driver_fingerprint !== null) {
    let url =
      `${
        /production/i.test(process.env.EVIRONMENT)
          ? `http://${process.env.INSTANCE_PRIVATE_IP}`
          : process.env.LOCAL_URL
      }` +
      ":" +
      process.env.DISPATCH_SERVICE_PORT +
      "/getRequests_graphNumbers?driver_fingerprint=" +
      req.driver_fingerprint;

    requestAPI(url, function (error, response, body) {
      //logger.info(body);
      if (error === null) {
        try {
          body = JSON.parse(body);
          res.send(body);
        } catch (error) {
          res.send({
            rides: 0,
            deliveries: 0,
            scheduled: 0,
            accepted: 0,
          });
        }
      } else {
        res.send({
          rides: 0,
          deliveries: 0,
          scheduled: 0,
          accepted: 0,
        });
      }
    });
  } else {
    res.send({
      rides: 0,
      deliveries: 0,
      scheduled: 0,
      accepted: 0,
    });
  }
});

/**
 * ACCOUNTS SERVICE, port 9696
 * Route: getDrivers_walletInfosDeep
 * event: getDrivers_walletInfosDeep_io
 * Responsible for computing the wallet deep summary for the drivers
 */
app.post("/getDrivers_walletInfosDeep_io", function (req, res) {
  //logger.info(req);
  req = req.body;

  if (req.user_fingerprint !== undefined && req.user_fingerprint !== null) {
    let url =
      `${
        /production/i.test(process.env.EVIRONMENT)
          ? `http://${process.env.INSTANCE_PRIVATE_IP}`
          : process.env.LOCAL_URL
      }` +
      ":" +
      process.env.ACCOUNTS_SERVICE_PORT +
      "/getDrivers_walletInfosDeep?user_fingerprint=" +
      req.user_fingerprint;

    requestAPI(url, function (error, response, body) {
      if (error === null) {
        try {
          body = JSON.parse(body);
          res.send(body);
        } catch (error) {
          res.send({
            header: null,
            weeks_view: null,
            response: "error",
          });
        }
      } else {
        res.send({
          header: null,
          weeks_view: null,
          response: "error",
        });
      }
    });
  } else {
    res.send({
      header: null,
      weeks_view: null,
      response: "error",
    });
  }
});

/**
 * ACCOUNTS SERVICE, port 9696
 * Route: getRiders_walletInfos
 * event: getRiders_walletInfos_io
 * Responsible for computing the wallet summary (total and details) for the riders.
 * ! TO BE RESTORED WITH THE WALLET AND OPTIMAL APP UPDATE.
 */
app.post("/getRiders_walletInfos_io", function (req, res) {
  //logger.info(req);
  req = req.body;
  if (
    req.user_fingerprint !== undefined &&
    req.user_fingerprint !== null &&
    req.mode !== undefined &&
    req.mode !== null
  ) {
    let url =
      `${
        /production/i.test(process.env.EVIRONMENT)
          ? `http://${process.env.INSTANCE_PRIVATE_IP}`
          : process.env.LOCAL_URL
      }` +
      ":" +
      process.env.ACCOUNTS_SERVICE_PORT +
      "/getRiders_walletInfos?user_fingerprint=" +
      req.user_fingerprint +
      "&mode=" +
      req.mode +
      "&avoidCached_data=true";

    requestAPI(url, function (error, response, body) {
      if (error === null) {
        try {
          body = JSON.parse(body);
          res.send(body);
        } catch (error) {
          res.send({
            total: 0,
            response: "error",
            tag: "invalid_parameters",
          });
        }
      } else {
        res.send({
          total: 0,
          response: "error",
          tag: "invalid_parameters",
        });
      }
    });
  } else {
    res.send({
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
app.post("/computeDaily_amountMadeSoFar_io", function (req, res) {
  //logger.info(req);
  req = req.body;

  if (req.driver_fingerprint !== undefined && req.driver_fingerprint !== null) {
    let url =
      `${
        /production/i.test(process.env.EVIRONMENT)
          ? `http://${process.env.INSTANCE_PRIVATE_IP}`
          : process.env.LOCAL_URL
      }` +
      ":" +
      process.env.ACCOUNTS_SERVICE_PORT +
      "/computeDaily_amountMadeSoFar?driver_fingerprint=" +
      req.driver_fingerprint;

    requestAPI(url, function (error, response, body) {
      //logger.info(body);
      if (error === null) {
        try {
          body = JSON.parse(body);
          res.send(body);
        } catch (error) {
          res.send({
            amount: 0,
            currency: "NAD",
            currency_symbol: "N$",
            response: "error",
          });
        }
      } else {
        res.send({
          amount: 0,
          currency: "NAD",
          currency_symbol: "N$",
          response: "error",
        });
      }
    });
  } else {
    res.send({
      amount: 0,
      currency: "NAD",
      currency_symbol: "N$",
      response: "error",
    });
  }
});

app.post("/sendOtpAndCheckerUserStatusTc", function (req, res) {
  logger.info(req);
  req = req.body;
  //...
  if (req.phone_number !== undefined && req.phone_number !== null) {
    let url =
      `${
        /production/i.test(process.env.EVIRONMENT)
          ? `http://${process.env.INSTANCE_PRIVATE_IP}`
          : process.env.LOCAL_URL
      }` +
      ":" +
      process.env.ACCOUNTS_SERVICE_PORT +
      "/sendOTPAndCheckUserStatus?phone_number=" +
      req.phone_number;

    if (req.smsHashLinker !== undefined && req.smsHashLinker !== null) {
      //Attach an hash linker for auto verification
      url += `&smsHashLinker=${encodeURIComponent(req.smsHashLinker)}`;
    }
    //Attach user nature
    if (req.user_nature !== undefined && req.user_nature !== null) {
      url += `&user_nature=${req.user_nature}`;
    }

    requestAPI(url, function (error, response, body) {
      //logger.info(body, error);
      if (error === null) {
        try {
          body = JSON.parse(body);
          //logger.info("HERE");
          res.send(body);
        } catch (error) {
          res.send({
            response: "error_checking_user",
          });
        }
      } else {
        res.send({
          response: "error_checking_user",
        });
      }
    });
  } else {
    res.send({
      response: "error_checking_user",
    });
  }
});

app.post("/checkThisOTP_SMS", function (req, res) {
  req = req.body;
  logger.info(req);
  if (
    req.phone_number !== undefined &&
    req.phone_number !== null &&
    req.otp !== undefined &&
    req.otp !== null
  ) {
    let url =
      `${
        /production/i.test(process.env.EVIRONMENT)
          ? `http://${process.env.INSTANCE_PRIVATE_IP}`
          : process.env.LOCAL_URL
      }` +
      ":" +
      process.env.ACCOUNTS_SERVICE_PORT +
      "/checkSMSOTPTruly?phone_number=" +
      req.phone_number +
      "&otp=" +
      req.otp;

    //Add the user nature : passengers (undefined) or drivers
    if (req.user_nature !== undefined && req.user_nature !== null) {
      url += `&user_nature=${req.user_nature}`;
    }

    requestAPI(url, function (error, response, body) {
      //logger.info(body);
      if (error === null) {
        try {
          body = JSON.parse(body);
          res.send(body);
        } catch (error) {
          res.send({
            response: "error_checking_otp",
          });
        }
      } else {
        res.send({
          response: "error_checking_otp",
        });
      }
    });
  } else {
    res.send({
      response: "error_checking_otp",
    });
  }
});

app.post("/goOnline_offlineDrivers_io", function (req, res) {
  req = req.body;
  //logger.info(req);
  if (
    req.driver_fingerprint !== undefined &&
    req.driver_fingerprint !== null &&
    req.action !== undefined &&
    req.action !== null
  ) {
    let url =
      `${
        /production/i.test(process.env.EVIRONMENT)
          ? `http://${process.env.INSTANCE_PRIVATE_IP}`
          : process.env.LOCAL_URL
      }` +
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
      if (error === null) {
        try {
          body = JSON.parse(body);
          res.send(body);
        } catch (error) {
          res.send({
            response: "error_invalid_request",
          });
        }
      } else {
        res.send({
          response: "error_invalid_request",
        });
      }
    });
  } else {
    res.send({
      response: "error_invalid_request",
    });
  }
});

app.post("/driversOverallNumbers", function (req, res) {
  logger.info(req);
  req = req.body;
  if (req.user_fingerprint !== undefined && req.user_fingerprint !== null) {
    let url =
      `${
        /production/i.test(process.env.EVIRONMENT)
          ? `http://${process.env.INSTANCE_PRIVATE_IP}`
          : process.env.LOCAL_URL
      }` +
      ":" +
      process.env.ACCOUNTS_SERVICE_PORT +
      "/getDriversGeneralAccountNumber?user_fingerprint=" +
      req.user_fingerprint;

    requestAPI(url, function (error, response, body) {
      // logger.info(body);
      if (error === null) {
        try {
          body = JSON.parse(body);
          res.send(body);
        } catch (error) {
          res.send({
            response: "error",
          });
        }
      } else {
        res.send({
          response: "error",
        });
      }
    });
  } else {
    res.send({
      response: "error",
    });
  }
});

app.post("/getRides_historyRiders_batchOrNot", function (req, res) {
  req = req.body;
  //logger.info(req);
  if (req.user_fingerprint !== undefined && req.user_fingerprint !== null) {
    let url =
      `${
        /production/i.test(process.env.EVIRONMENT)
          ? `http://${process.env.INSTANCE_PRIVATE_IP}`
          : process.env.LOCAL_URL
      }` +
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
    //? Add the user nature for drivers if any
    if (req.user_nature !== undefined && req.user_nature !== null) {
      url += `&user_nature=${req.user_nature}`;
    }
    //...
    requestAPI(url, function (error, response, body) {
      //logger.info(error, body);
      if (error === null) {
        try {
          body = JSON.parse(body);
          res.send(body);
        } catch (error) {
          res.send({
            response: "error_authentication_failed",
          });
        }
      } else {
        res.send({
          response: "error_authentication_failed",
        });
      }
    });
  } else {
    res.send({
      response: "error_authentication_failed",
    });
  }
});

//! DISABLE EXTERNAL SERVING FOR SECURITY REASONS.
//!.use(express.static(__dirname + process.env.RIDERS_PROFILE_PICTURES_PATH)) //Riders profiles
//!.use(express.static(__dirname + process.env.DRIVERS_PROFILE_PICTURES_PATH)); //Drivers profiles.

//EVENTS ROUTER
io.on("connection", (socket) => {
  logger.info("Connected to the event gateway.");
  /**
   * MAP SERVICE, port 9090
   * Route: updatePassengerLocation
   * Event: update-passenger-location
   * Update the passenger's location in the system and prefetch the navigation data if any.
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
      let url =
        `${
          /production/i.test(process.env.EVIRONMENT)
            ? `http://${process.env.INSTANCE_PRIVATE_IP}`
            : process.env.LOCAL_URL
        }` +
        ":" +
        process.env.MAP_SERVICE_PORT +
        "/updatePassengerLocation";
      //Supplement or not the request string based on if the user is a driver or rider
      if (req.user_nature !== undefined && req.user_nature !== null) {
        req.user_nature =
          req.user_nature !== undefined && req.user_nature !== null
            ? req.user_nature
            : "rider";
        req.requestType =
          req.requestType !== undefined && req.requestType !== null
            ? req.requestType
            : "rides";
      }
      //...

      requestAPI.post({ url, form: req }, function (error, response, body) {
        if (error === null) {
          try {
            body = JSON.parse(body);
            //logger.info(body);
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
    if (
      req.latitude !== undefined &&
      req.latitude !== null &&
      req.longitude !== undefined &&
      req.longitude !== null &&
      req.user_fingerprint !== null &&
      req.user_fingerprint !== undefined
    ) {
      let url =
        `${
          /production/i.test(process.env.EVIRONMENT)
            ? `http://${process.env.INSTANCE_PRIVATE_IP}`
            : process.env.LOCAL_URL
        }` +
        ":" +
        process.env.MAP_SERVICE_PORT +
        "/getUserLocationInfos";

      requestAPI.post({ url, form: req }, function (error, response, body) {
        logger.info(url);
        logger.info(body, error);
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
    //logger.info("identify location...");

    if (
      req.latitude !== undefined &&
      req.latitude !== null &&
      req.longitude !== undefined &&
      req.longitude !== null &&
      req.user_fingerprint !== null &&
      req.user_fingerprint !== undefined
    ) {
      let url =
        `${
          /production/i.test(process.env.EVIRONMENT)
            ? `http://${process.env.INSTANCE_PRIVATE_IP}`
            : process.env.LOCAL_URL
        }` +
        ":" +
        process.env.MAP_SERVICE_PORT +
        "/identifyPickupLocation?latitude=" +
        req.latitude +
        "&longitude=" +
        req.longitude +
        "&user_fingerprint=" +
        req.user_fingerprint;
      requestAPI(url, function (error, response, body) {
        ////logger.info(body);
        if (error === null) {
          try {
            body = JSON.parse(body);
            socket.emit("getPickupLocationNature-response", body);
          } catch (error) {
            socket.emit("getPickupLocationNature-response", {
              locationType: "PrivateLocation",
            });
          }
        } else {
          socket.emit("getPickupLocationNature-response", {
            locationType: "PrivateLocation",
          });
        }
      });
    } //Invalid params
    else {
      socket.emit("getPickupLocationNature-response", {
        locationType: "PrivateLocation",
      });
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
    //logger.info("Finding route snapshot");
    ////logger.info(req);

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
        `${
          /production/i.test(process.env.EVIRONMENT)
            ? `http://${process.env.INSTANCE_PRIVATE_IP}`
            : process.env.LOCAL_URL
        }` +
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
        //logger.info(body);
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
    ////logger.info("Getting all the closest drivers");
    ////logger.info(req);
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
        `${
          /production/i.test(process.env.EVIRONMENT)
            ? `http://${process.env.INSTANCE_PRIVATE_IP}`
            : process.env.LOCAL_URL
        }` +
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
        if (error === null) {
          try {
            body = JSON.parse(body);
            //! Force the limit to 7
            body =
              body.length !== undefined && body.length > 7
                ? body.slice(0, 7)
                : body;
            //!---

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
   * route name: getSharedTrip_information
   * event: getSharedTrip_information_io
   * Responsible for getting the shared rides information from
   */
  socket.on("getSharedTrip_information_io", function (req) {
    if (
      req.sharedTo_user_fingerprint !== undefined &&
      req.sharedTo_user_fingerprint !== null &&
      req.trip_simplified_id !== undefined &&
      req.trip_simplified_id !== null
    ) {
      let url =
        `${
          /production/i.test(process.env.EVIRONMENT)
            ? `http://${process.env.INSTANCE_PRIVATE_IP}`
            : process.env.LOCAL_URL
        }` +
        ":" +
        process.env.MAP_SERVICE_PORT +
        "/getSharedTrip_information?sharedTo_user_fingerprint=" +
        req.sharedTo_user_fingerprint +
        "&trip_simplified_id=" +
        req.trip_simplified_id;
      logger.error(url);
      requestAPI(url, function (error, response, body) {
        logger.warn(error);
        logger.error(body);
        if (error === null) {
          try {
            body = JSON.parse(body);
            socket.emit("getSharedTrip_information_io-response", body);
            socket.emit("trackdriverroute-response", body);
          } catch (error) {
            socket.emit("getSharedTrip_information_io-response", {
              response: "error",
              flag: false,
            });
          }
        } else {
          socket.emit("getSharedTrip_information_io-response", {
            response: "error",
            flag: false,
          });
        }
      });
    } //Invalid params
    else {
      socket.emit("getSharedTrip_information_io-response", {
        response: "error",
        flag: false,
      });
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
        `${
          /production/i.test(process.env.EVIRONMENT)
            ? `http://${process.env.INSTANCE_PRIVATE_IP}`
            : process.env.LOCAL_URL
        }` +
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
        ////logger.info(body);
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
    logger.info(req);
    if (
      req.user_fp !== undefined &&
      req.user_fp !== null &&
      req.query !== undefined &&
      req.query !== null &&
      req.city !== undefined &&
      req.city !== null
    ) {
      let url =
        `${
          /production/i.test(process.env.EVIRONMENT)
            ? `http://${process.env.INSTANCE_PRIVATE_IP}`
            : process.env.LOCAL_URL
        }` +
        ":" +
        process.env.SEARCH_SERVICE_PORT +
        "/getSearchedLocations";

      requestAPI.post({ url, form: req }, function (error, response, body) {
        ////logger.info(body);
        if (error === null) {
          try {
            body = JSON.parse(body);
            logger.warn(body);
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
   * PRICING SERVICE, port 9797
   * Route: getOverallPricingAndAvailabilityDetails
   * event: getPricingForRideorDelivery
   * Get fare estimations for any ride or delivery booking
   */
  socket.on("getPricingForRideorDelivery", function (req) {
    ////logger.info(req);
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
        `${
          /production/i.test(process.env.EVIRONMENT)
            ? `http://${process.env.INSTANCE_PRIVATE_IP}`
            : process.env.LOCAL_URL
        }` +
        ":" +
        process.env.PRICING_SERVICE_PORT +
        "/getOverallPricingAndAvailabilityDetails";

      requestAPI.post({ url, form: req }, function (error, response, body) {
        //logger.info(body);
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
   * PRICING SERVICE, port 9797
   * Route: getUpdateInRealtimePassengerFare
   * event: getUpdateInRealtimePassengerFare_io
   * Get fare estimations for any ride or delivery booking
   */
  socket.on("getUpdateInRealtimePassengerFare_io", function (req) {
    ////logger.info(req);
    let url =
      `${
        /production/i.test(process.env.EVIRONMENT)
          ? `http://${process.env.INSTANCE_PRIVATE_IP}`
          : process.env.LOCAL_URL
      }` +
      ":" +
      process.env.PRICING_SERVICE_PORT +
      "/getUpdateInRealtimePassengerFare";

    requestAPI.post({ url, form: req }, function (error, response, body) {
      //logger.info(body);
      if (error === null) {
        try {
          body = JSON.parse(body);
          if (body.response !== undefined) {
            //Error
            socket.emit("getUpdateInRealtimePassengerFare_io-response", body);
          } //SUCCESS
          else {
            socket.emit("getUpdateInRealtimePassengerFare_io-response", body);
          }
        } catch (error) {
          socket.emit("getUpdateInRealtimePassengerFare_io-response", false);
        }
      } else {
        socket.emit("getUpdateInRealtimePassengerFare_io-response", false);
      }
    });
  });

  /**
   * DISPATCH SERVICE, port 9094
   * Route: dispatchRidesOrDeliveryRequests
   * event: requestRideOrDeliveryForThis
   * Make a ride or delivery request for a rider.
   */
  socket.on("requestRideOrDeliveryForThis", function (req) {
    // logger.info(req);
    if (req.user_fingerprint !== undefined && req.user_fingerprint !== null) {
      let url =
        `${
          /production/i.test(process.env.EVIRONMENT)
            ? `http://${process.env.INSTANCE_PRIVATE_IP}`
            : process.env.LOCAL_URL
        }` +
        ":" +
        process.env.DISPATCH_SERVICE_PORT +
        "/dispatchRidesOrDeliveryRequests";

      requestAPI.post({ url, form: req }, function (error, response, body) {
        logger.info(error, body);
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
   * Route: getRequests_graphNumbers
   * event: update_requestsGraph
   * Update the general requests numbers for ease of access
   */
  socket.on("update_requestsGraph", function (req) {
    //logger.info(req);
    if (
      req.driver_fingerprint !== undefined &&
      req.driver_fingerprint !== null
    ) {
      let url =
        `${
          /production/i.test(process.env.EVIRONMENT)
            ? `http://${process.env.INSTANCE_PRIVATE_IP}`
            : process.env.LOCAL_URL
        }` +
        ":" +
        process.env.DISPATCH_SERVICE_PORT +
        "/getRequests_graphNumbers?driver_fingerprint=" +
        req.driver_fingerprint;

      requestAPI(url, function (error, response, body) {
        //logger.info(body);
        if (error === null) {
          try {
            body = JSON.parse(body);
            socket.emit("update_requestsGraph-response", body);
          } catch (error) {
            socket.emit("update_requestsGraph-response", {
              rides: 0,
              deliveries: 0,
              scheduled: 0,
            });
          }
        } else {
          socket.emit("update_requestsGraph-response", {
            rides: 0,
            deliveries: 0,
            scheduled: 0,
          });
        }
      });
    } else {
      socket.emit("update_requestsGraph-response", {
        rides: 0,
        deliveries: 0,
        scheduled: 0,
      });
    }
  });

  /**
   * DISPATCH SERVICE, port 9094
   * Route: decline_request
   * event: declineRequest_driver
   * Decline any request from the driver's side.
   */
  socket.on("declineRequest_driver", function (req) {
    //logger.info(req);
    if (
      req.driver_fingerprint !== undefined &&
      req.driver_fingerprint !== null &&
      req.request_fp !== undefined &&
      req.request_fp !== null
    ) {
      let url =
        `${
          /production/i.test(process.env.EVIRONMENT)
            ? `http://${process.env.INSTANCE_PRIVATE_IP}`
            : process.env.LOCAL_URL
        }` +
        ":" +
        process.env.DISPATCH_SERVICE_PORT +
        "/decline_request";

      requestAPI.post({ url, form: req }, function (error, response, body) {
        //logger.info(body);
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
    //logger.info(req);
    if (
      req.driver_fingerprint !== undefined &&
      req.driver_fingerprint !== null &&
      req.request_fp !== undefined &&
      req.request_fp !== null
    ) {
      let url =
        `${
          /production/i.test(process.env.EVIRONMENT)
            ? `http://${process.env.INSTANCE_PRIVATE_IP}`
            : process.env.LOCAL_URL
        }` +
        ":" +
        process.env.DISPATCH_SERVICE_PORT +
        "/accept_request";

      requestAPI.post({ url, form: req }, function (error, response, body) {
        //logger.info(body);
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
    //logger.info(req);
    if (
      req.driver_fingerprint !== undefined &&
      req.driver_fingerprint !== null &&
      req.request_fp !== undefined &&
      req.request_fp !== null
    ) {
      let url =
        `${
          /production/i.test(process.env.EVIRONMENT)
            ? `http://${process.env.INSTANCE_PRIVATE_IP}`
            : process.env.LOCAL_URL
        }` +
        ":" +
        process.env.DISPATCH_SERVICE_PORT +
        "/cancel_request_driver";

      requestAPI.post({ url, form: req }, function (error, response, body) {
        //logger.info(body);
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
    //logger.info(req);
    if (
      // req.driver_fingerprint !== undefined &&
      // req.driver_fingerprint !== null &&
      req.request_fp !== undefined &&
      req.request_fp !== null
    ) {
      let url =
        `${
          /production/i.test(process.env.EVIRONMENT)
            ? `http://${process.env.INSTANCE_PRIVATE_IP}`
            : process.env.LOCAL_URL
        }` +
        ":" +
        process.env.DISPATCH_SERVICE_PORT +
        "/confirm_pickup_request_driver";

      requestAPI.post({ url, form: req }, function (error, response, body) {
        //logger.info(body);
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
    //logger.info(req);
    if (
      req.driver_fingerprint !== undefined &&
      req.driver_fingerprint !== null &&
      req.request_fp !== undefined &&
      req.request_fp !== null
    ) {
      let url =
        `${
          /production/i.test(process.env.EVIRONMENT)
            ? `http://${process.env.INSTANCE_PRIVATE_IP}`
            : process.env.LOCAL_URL
        }` +
        ":" +
        process.env.DISPATCH_SERVICE_PORT +
        "/confirm_dropoff_request_driver";

      requestAPI.post({ url, form: req }, function (error, response, body) {
        //logger.info(body);
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
    //logger.info(req);
    if (req.user_fingerprint !== undefined && req.user_fingerprint !== null) {
      let url =
        `${
          /production/i.test(process.env.EVIRONMENT)
            ? `http://${process.env.INSTANCE_PRIVATE_IP}`
            : process.env.LOCAL_URL
        }` +
        ":" +
        process.env.DISPATCH_SERVICE_PORT +
        "/confirmRiderDropoff_requests";

      requestAPI.post({ url, form: req }, function (error, response, body) {
        //logger.info(body);
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
    //logger.info(req);
    if (req.user_fingerprint !== undefined && req.user_fingerprint !== null) {
      let url =
        `${
          /production/i.test(process.env.EVIRONMENT)
            ? `http://${process.env.INSTANCE_PRIVATE_IP}`
            : process.env.LOCAL_URL
        }` +
        ":" +
        process.env.DISPATCH_SERVICE_PORT +
        "/cancelRiders_request";

      requestAPI.post({ url, form: req }, function (error, response, body) {
        //logger.info(body);
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
    //logger.info(req);
    if (req.phone_number !== undefined && req.phone_number !== null) {
      let url =
        `${
          /production/i.test(process.env.EVIRONMENT)
            ? `http://${process.env.INSTANCE_PRIVATE_IP}`
            : process.env.LOCAL_URL
        }` +
        ":" +
        process.env.ACCOUNTS_SERVICE_PORT +
        "/sendOTPAndCheckUserStatus?phone_number=" +
        req.phone_number;

      if (req.smsHashLinker !== undefined && req.smsHashLinker !== null) {
        //Attach an hash linker for auto verification
        url += `&smsHashLinker=${encodeURIComponent(req.smsHashLinker)}`;
      }
      //Attach user nature
      if (req.user_nature !== undefined && req.user_nature !== null) {
        url += `&user_nature=${req.user_nature}`;
      }

      requestAPI(url, function (error, response, body) {
        //logger.info(body, error);
        if (error === null) {
          try {
            body = JSON.parse(body);
            //logger.info("HERE");
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
   * ! TO BE RESTORED WITH THE WALLET AND OPTIMAL APP UPDATE.
   */
  socket.on("getRiders_walletInfos_io", function (req) {
    //logger.info(req);
    if (
      req.user_fingerprint !== undefined &&
      req.user_fingerprint !== null &&
      req.mode !== undefined &&
      req.mode !== null
    ) {
      let url =
        `${
          /production/i.test(process.env.EVIRONMENT)
            ? `http://${process.env.INSTANCE_PRIVATE_IP}`
            : process.env.LOCAL_URL
        }` +
        ":" +
        process.env.ACCOUNTS_SERVICE_PORT +
        "/getRiders_walletInfos?user_fingerprint=" +
        req.user_fingerprint +
        "&mode=" +
        req.mode +
        "&avoidCached_data=true";

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
   * Route: getDrivers_walletInfosDeep
   * event: getDrivers_walletInfosDeep_io
   * Responsible for computing the wallet deep summary for the drivers
   */
  socket.on("getDrivers_walletInfosDeep_io", function (req) {
    //logger.info(req);
    if (req.user_fingerprint !== undefined && req.user_fingerprint !== null) {
      let url =
        `${
          /production/i.test(process.env.EVIRONMENT)
            ? `http://${process.env.INSTANCE_PRIVATE_IP}`
            : process.env.LOCAL_URL
        }` +
        ":" +
        process.env.ACCOUNTS_SERVICE_PORT +
        "/getDrivers_walletInfosDeep?user_fingerprint=" +
        req.user_fingerprint;

      requestAPI(url, function (error, response, body) {
        if (error === null) {
          try {
            body = JSON.parse(body);
            socket.emit("getDrivers_walletInfosDeep_io-response", body);
          } catch (error) {
            socket.emit("getDrivers_walletInfosDeep_io-response", {
              header: null,
              weeks_view: null,
              response: "error",
            });
          }
        } else {
          socket.emit("getDrivers_walletInfosDeep_io-response", {
            header: null,
            weeks_view: null,
            response: "error",
          });
        }
      });
    } else {
      socket.emit("getRiders_walletInfos_io-response", {
        header: null,
        weeks_view: null,
        response: "error",
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
    //logger.info(req);
    if (
      req.driver_fingerprint !== undefined &&
      req.driver_fingerprint !== null
    ) {
      let url =
        `${
          /production/i.test(process.env.EVIRONMENT)
            ? `http://${process.env.INSTANCE_PRIVATE_IP}`
            : process.env.LOCAL_URL
        }` +
        ":" +
        process.env.ACCOUNTS_SERVICE_PORT +
        "/computeDaily_amountMadeSoFar?driver_fingerprint=" +
        req.driver_fingerprint;

      requestAPI(url, function (error, response, body) {
        //logger.info(body);
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
    //logger.info(req);
    if (
      req.driver_fingerprint !== undefined &&
      req.driver_fingerprint !== null &&
      req.action !== undefined &&
      req.action !== null
    ) {
      let url =
        `${
          /production/i.test(process.env.EVIRONMENT)
            ? `http://${process.env.INSTANCE_PRIVATE_IP}`
            : process.env.LOCAL_URL
        }` +
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
    //logger.info(req);
    if (
      req.phone_number !== undefined &&
      req.phone_number !== null &&
      req.otp !== undefined &&
      req.otp !== null
    ) {
      let url =
        `${
          /production/i.test(process.env.EVIRONMENT)
            ? `http://${process.env.INSTANCE_PRIVATE_IP}`
            : process.env.LOCAL_URL
        }` +
        ":" +
        process.env.ACCOUNTS_SERVICE_PORT +
        "/checkSMSOTPTruly?phone_number=" +
        req.phone_number +
        "&otp=" +
        req.otp;

      //Add the user nature : passengers (undefined) or drivers
      if (req.user_nature !== undefined && req.user_nature !== null) {
        url += `&user_nature=${req.user_nature}`;
      }

      requestAPI(url, function (error, response, body) {
        //logger.info(body);
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
   * Route: gatherAdsManagerAnalytics
   * event: gatherAdsManagerAnalytics_io
   * Save all the ads events collected from the users devices (riders/drivers)
   */
  socket.on("gatherAdsManagerAnalytics_io", function (req) {
    logger.warn(req);
    // socket.emit("gatherAdsManagerAnalytics_io-response", {
    //   response: "error_noAds",
    // });
    if (
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
      let url = /production/i.test(process.env.EVIRONMENT)
        ? `http://${process.env.INSTANCE_PRIVATE_IP}`
        : process.env.LOCAL_URL +
          ":" +
          process.env.ACCOUNTS_SERVICE_PORT +
          "/gatherAdsManagerAnalytics";

      requestAPI.post({ url, form: req }, function (error, response, body) {
        //logger.info(body);
        if (error === null) {
          try {
            body = JSON.parse(body);
            socket.emit("gatherAdsManagerAnalytics_io-response", body);
          } catch (error) {
            socket.emit("gatherAdsManagerAnalytics_io-response", {
              response: "error_noAds",
            });
          }
        } else {
          socket.emit("gatherAdsManagerAnalytics_io-response", {
            response: "error_noAds",
          });
        }
      });
    } else {
      socket.emit("gatherAdsManagerAnalytics_io-response", {
        response: "error_noAds",
      });
    }
  });

  /**
   * ACCOUNTS SERVICE, port 9696
   * Route: performOpsCorporateDeliveryAccount
   * event: opsOnCorpoDeliveryAccounts_io
   * Performs auth operations on the corporate delivery accounts
   */
  socket.on("opsOnCorpoDeliveryAccounts_io", function (req) {
    logger.warn(req);

    if (
      req !== undefined &&
      req !== null &&
      req.op !== undefined &&
      req.op !== null
    ) {
      let url = `${
        /production/i.test(process.env.EVIRONMENT)
          ? `http://${process.env.INSTANCE_PRIVATE_IP}`
          : process.env.LOCAL_URL
      }:${
        process.env.ACCOUNTS_SERVICE_PORT
      }/performOpsCorporateDeliveryAccount`;

      logger.warn(url);

      //!Deduce the event name response based on the op
      //? 1. op: resendConfirmationSMS
      //? 2. op: updatePhoneNumber
      //? 3. op: validatePhoneNumber
      let eventResponseName = /resendConfirmationSMS/i.test(req.op)
        ? "resetConfirmationSMSDeliveryWeb_io-response"
        : /updatePhoneNumber/i.test(req.op)
        ? "updatePhoneNumberDeliveryWeb_io-response"
        : /validatePhoneNumber/i.test(req.op)
        ? "validatePhoneNumberDeliveryWeb_io-response"
        : /getAccountData/i.test(req.op)
        ? "getAccountDataDeliveryWeb_io-response"
        : "opsOnCorpoDeliveryAccounts_io-response";

      //!-----

      requestAPI.post({ url, form: req }, function (error, response, body) {
        //logger.info(body);
        if (error === null) {
          try {
            body = JSON.parse(body);
            socket.emit(eventResponseName, body);
          } catch (error) {
            socket.emit(eventResponseName, {
              response: "error_invalid_data",
            });
          }
        } else {
          socket.emit(eventResponseName, {
            response: "error_invalid_data",
          });
        }
      });
    } else {
      socket.emit(eventResponseName, {
        response: "error_invalid_data",
      });
    }
  });

  /**
   * ACCOUNTS SERVICE, port 9696
   * Route: getNotifications_ops
   * event: getNotifications_infos_io
   * Responsible for getting the notifications data bulkly
   */
  socket.on("getNotifications_infos_io", function (req) {
    logger.warn(req);

    if (
      req !== undefined &&
      req !== null &&
      req.op !== undefined &&
      req.op !== null
    ) {
      let url = `${
        /production/i.test(process.env.EVIRONMENT)
          ? `http://${process.env.INSTANCE_PRIVATE_IP}`
          : process.env.LOCAL_URL
      }:${process.env.ACCOUNTS_SERVICE_PORT}/getNotifications_ops`;

      logger.warn(url);
      let eventResponseName = "getNotifications_infos_io-response";

      requestAPI.post({ url, form: req }, function (error, response, body) {
        //logger.info(body);
        if (error === null) {
          try {
            body = JSON.parse(body);
            socket.emit(eventResponseName, body);
          } catch (error) {
            socket.emit(eventResponseName, {
              response: "error",
            });
          }
        } else {
          socket.emit(eventResponseName, {
            response: "error",
          });
        }
      });
    } else {
      socket.emit(eventResponseName, {
        response: "error",
      });
    }
  });

  /**
   * ACCOUNTS SERVICE, port 9696
   * Route: getAdsManagerRunningInfos
   * event: getAdsManagerRunningInfos_io
   * Get all the running Ads campaigns (usually just one at the time) in the current city.
   */
  socket.on("getAdsManagerRunningInfos_io", function (req) {
    //logger.info(req);
    if (
      req.user_fingerprint !== undefined &&
      req.user_fingerprint !== null &&
      req.user_nature !== undefined &&
      req.user_nature !== null &&
      req.city !== undefined &&
      req.city !== null
    ) {
      let url =
        `${
          /production/i.test(process.env.EVIRONMENT)
            ? `http://${process.env.INSTANCE_PRIVATE_IP}`
            : process.env.LOCAL_URL
        }` +
        ":" +
        process.env.ACCOUNTS_SERVICE_PORT +
        "/getAdsManagerRunningInfos?user_fingerprint=" +
        req.user_fingerprint +
        "&user_nature=" +
        req.user_nature +
        "&city=" +
        req.city;

      requestAPI(url, function (error, response, body) {
        //logger.info(body);
        if (error === null) {
          try {
            body = JSON.parse(body);
            socket.emit("getAdsManagerRunningInfos_io-response", body);
          } catch (error) {
            socket.emit("getAdsManagerRunningInfos_io-response", {
              response: "error_noAds",
            });
          }
        } else {
          socket.emit("getAdsManagerRunningInfos_io-response", {
            response: "error_noAds",
          });
        }
      });
    } else {
      socket.emit("gatherAdsManagerAnalytics_io-response", {
        response: "error_noAds",
      });
    }
  });

  /**
   * ACCOUNTS SERVICE, port 9696
   * Route: getDriversGeneralAccountNumber
   * event: driversOverallNumbers
   * Get all the big numbers for a drivers account
   */
  socket.on("driversOverallNumbers", function (req) {
    //logger.info(req);
    if (req.user_fingerprint !== undefined && req.user_fingerprint !== null) {
      let url =
        `${
          /production/i.test(process.env.EVIRONMENT)
            ? `http://${process.env.INSTANCE_PRIVATE_IP}`
            : process.env.LOCAL_URL
        }` +
        ":" +
        process.env.ACCOUNTS_SERVICE_PORT +
        "/getDriversGeneralAccountNumber?user_fingerprint=" +
        req.user_fingerprint;

      requestAPI(url, function (error, response, body) {
        //logger.info(body);
        if (error === null) {
          try {
            body = JSON.parse(body);
            socket.emit("driversOverallNumbers-response", body);
          } catch (error) {
            socket.emit("driversOverallNumbers-response", {
              response: "error",
            });
          }
        } else {
          socket.emit("driversOverallNumbers-response", {
            response: "error",
          });
        }
      });
    } else {
      socket.emit("driversOverallNumbers-response", {
        response: "error",
      });
    }
  });

  /**
   * ACCOUNTS SERVICE, port 9696
   * Route: updateRiders_profileInfos
   * event: updateRiders_profileInfos_io
   * Responsible for updating ANY information related to the passengers profile.
   * Informations that can be updated: name, surname, picture, email, phone number, gender.
   */
  socket.on("updateRiders_profileInfos_io", function (req) {
    //logger.info(req);
    if (
      req.user_fingerprint !== undefined &&
      req.user_fingerprint !== null &&
      req.infoToUpdate !== undefined &&
      req.infoToUpdate !== null &&
      req.dataToUpdate !== undefined &&
      req.dataToUpdate !== null
    ) {
      let url =
        `${
          /production/i.test(process.env.EVIRONMENT)
            ? `http://${process.env.INSTANCE_PRIVATE_IP}`
            : process.env.LOCAL_URL
        }` +
        ":" +
        process.env.ACCOUNTS_SERVICE_PORT +
        "/updateRiders_profileInfos";

      requestAPI.post({ url, form: req }, function (error, response, body) {
        //logger.info(body);
        if (error === null) {
          try {
            body = JSON.parse(body);
            socket.emit("updateRiders_profileInfos_io-response", body);
          } catch (error) {
            socket.emit("updateRiders_profileInfos_io-response", {
              response: "error",
              flag: "invalid_data",
            });
          }
        } else {
          socket.emit("updateRiders_profileInfos_io-response", {
            response: "error",
            flag: "invalid_data",
          });
        }
      });
    } else {
      socket.emit("updateRiders_profileInfos_io-response", {
        response: "error",
        flag: "invalid_data",
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
    //logger.info(req);
    if (req.phone_number !== undefined && req.phone_number !== null) {
      let url =
        `${
          /production/i.test(process.env.EVIRONMENT)
            ? `http://${process.env.INSTANCE_PRIVATE_IP}`
            : process.env.LOCAL_URL
        }` +
        ":" +
        process.env.ACCOUNTS_SERVICE_PORT +
        "/createMinimalRiderAccount?phone_number=" +
        req.phone_number +
        "&pushnotif_token=" +
        (req.pushnotif_token !== undefined && req.pushnotif_token !== null
          ? encodeURIComponent(req.pushnotif_token)
          : false);
      //logger.info(url);
      requestAPI(url, function (error, response, body) {
        //logger.info(error, body);
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
   * Route: checkOrBlockDriversFromRider
   * event: checkDriverForPotentialblock
   * Check if the phone number is linked to a driver's account for a potential block
   */
  socket.on("checkDriverForPotentialblock", function (req) {
    //logger.info(req);
    if (req.op !== undefined && req.op !== null) {
      let url =
        `${
          /production/i.test(process.env.EVIRONMENT)
            ? `http://${process.env.INSTANCE_PRIVATE_IP}`
            : process.env.LOCAL_URL
        }` +
        ":" +
        process.env.ACCOUNTS_SERVICE_PORT +
        "/checkOrBlockDriversFromRider";
      //logger.info(url);
      requestAPI.post({ url, form: req }, function (error, response, body) {
        //logger.info(error, body);
        if (error === null) {
          try {
            body = JSON.parse(body);
            //Add the operation
            socket.emit(
              `checkDriverForPotentialblock-${req.op}-response`,
              body
            );
          } catch (error) {
            socket.emit(`checkDriverForPotentialblock-${req.op}-response`, {
              response: "error_unable_to_block",
            });
          }
        } else {
          socket.emit(`checkDriverForPotentialblock-${req.op}-response`, {
            response: "error_unable_to_block",
          });
        }
      });
    } else {
      socket.emit(`checkDriverForPotentialblock-${req.op}-response`, {
        response: "error_unable_to_block",
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
    //logger.info(req);
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
        `${
          /production/i.test(process.env.EVIRONMENT)
            ? `http://${process.env.INSTANCE_PRIVATE_IP}`
            : process.env.LOCAL_URL
        }` +
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
        //logger.info(error, body);
        if (error === null) {
          try {
            body = JSON.parse(body);
            socket.emit("updateAdditionalProfileData-response", body);
          } catch (error) {
            //logger.info(error);
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
    //logger.info(req);
    if (req.user_fingerprint !== undefined && req.user_fingerprint !== null) {
      let url =
        `${
          /production/i.test(process.env.EVIRONMENT)
            ? `http://${process.env.INSTANCE_PRIVATE_IP}`
            : process.env.LOCAL_URL
        }` +
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
      //? Add the user nature for drivers if any
      if (req.user_nature !== undefined && req.user_nature !== null) {
        url += `&user_nature=${req.user_nature}`;
      }
      //...
      requestAPI(url, function (error, response, body) {
        //logger.info(error, body);
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

  /**
   * PAYMENTS SERVICE, port 9093
   * Route: getRiders_walletInfos
   * event: getRiders_walletInfos_io
   * Responsible for computing the wallet summary (total and details) for the riders.
   */
  socket.on("checkRecipient_information_beforeTransfer", function (req) {
    //logger.info(req);
    if (
      req.user_fingerprint !== undefined &&
      req.user_fingerprint !== null &&
      req.user_nature !== undefined &&
      req.user_nature !== null &&
      req.payNumberOrPhoneNumber !== undefined &&
      req.payNumberOrPhoneNumber !== null
    ) {
      let url =
        `${
          /production/i.test(process.env.EVIRONMENT)
            ? `http://${process.env.INSTANCE_PRIVATE_IP}`
            : process.env.LOCAL_URL
        }` +
        ":" +
        process.env.PAYMENT_SERVICE_PORT +
        "/checkReceiverDetails_walletTransaction?user_fingerprint=" +
        req.user_fingerprint +
        "&user_nature=" +
        req.user_nature +
        "&payNumberOrPhoneNumber=" +
        req.payNumberOrPhoneNumber;

      requestAPI(url, function (error, response, body) {
        if (error === null) {
          try {
            body = JSON.parse(body);
            socket.emit(
              "checkRecipient_information_beforeTransfer-response",
              body
            );
          } catch (error) {
            socket.emit("checkRecipient_information_beforeTransfer-response", {
              response: "error",
              flag: "transaction_error",
            });
          }
        } else {
          socket.emit("checkRecipient_information_beforeTransfer-response", {
            response: "error",
            flag: "transaction_error",
          });
        }
      });
    } else {
      socket.emit("checkRecipient_information_beforeTransfer-response", {
        response: "error",
        flag: "transaction_error",
      });
    }
  });

  /**
   * PAYMENTS SERVICE, port 9093
   * Route: sendMoney_fromWalletRider_transaction
   * event: makeWallet_transaction_io
   * Responsible for executing the wallet transfer from a rider to friend or a driver.
   */
  socket.on("makeWallet_transaction_io", function (req) {
    //logger.info(req);
    if (
      req.user_fingerprint !== undefined &&
      req.user_fingerprint !== null &&
      req.user_nature !== undefined &&
      req.user_nature !== null &&
      req.payNumberOrPhoneNumber !== undefined &&
      req.payNumberOrPhoneNumber !== null &&
      req.amount !== undefined &&
      req.amount !== null
    ) {
      let url =
        `${
          /production/i.test(process.env.EVIRONMENT)
            ? `http://${process.env.INSTANCE_PRIVATE_IP}`
            : process.env.LOCAL_URL
        }` +
        ":" +
        process.env.PAYMENT_SERVICE_PORT +
        "/sendMoney_fromWalletRider_transaction?user_fingerprint=" +
        req.user_fingerprint +
        "&user_nature=" +
        req.user_nature +
        "&payNumberOrPhoneNumber=" +
        req.payNumberOrPhoneNumber +
        "&amount=" +
        req.amount;

      requestAPI(url, function (error, response, body) {
        if (error === null) {
          try {
            body = JSON.parse(body);
            socket.emit("makeWallet_transaction_io-response", body);
          } catch (error) {
            socket.emit("makeWallet_transaction_io-response", {
              response: "error",
              flag: "transaction_error",
            });
          }
        } else {
          socket.emit("makeWallet_transaction_io-response", {
            response: "error",
            flag: "transaction_error",
          });
        }
      });
    } else {
      socket.emit("makeWallet_transaction_io-response", {
        response: "error",
        flag: "transaction_error",
      });
    }
  });

  /**
   * PAYMENTS SERVICE, port 9093
   * Route: voucherProcessorExec
   * event: voucherProcessorExec_io
   * Responsible for applying or getting the voucher list
   */
  socket.on("voucherProcessorExec_io", function (req) {
    //logger.info(req);
    let url =
      `${
        /production/i.test(process.env.EVIRONMENT)
          ? `http://${process.env.INSTANCE_PRIVATE_IP}`
          : process.env.LOCAL_URL
      }` +
      ":" +
      process.env.PAYMENT_SERVICE_PORT +
      "/voucherProcessorExec";

    requestAPI.post({ url, form: req }, function (error, response, body) {
      if (error === null) {
        try {
          body = JSON.parse(body);
          socket.emit("voucherProcessorExec_io-response", body);
        } catch (error) {
          socket.emit("voucherProcessorExec_io-response", {
            response: "error",
            flag: "error_invalid_operation",
          });
        }
      } else {
        socket.emit("makeWallet_transaction_io-response", {
          response: "error",
          flag: "error_invalid_operation",
        });
      }
    });
  });

  /**
   * PAYMENTS SERVICE, port 9093
   * Route: topUPThisWalletTaxiconnect
   * event: topUp_wallet_io
   * Responsible for executing the wallet top-up from only the riders side.
   */
  socket.on("topUp_wallet_io", function (req) {
    //logger.info(req);
    //? Make sure that the city and country are provided or - defaults them to Windhoek Namibia
    req.city =
      req.city !== undefined && req.city !== null && req.city !== false
        ? req.city
        : "Windhoek";
    req.country =
      req.country !== undefined &&
      req.country !== null &&
      req.country !== false &&
      req.country.length <= 2
        ? req.country
        : "NA"; //! Required 2 digits for countries - DPO ref
    //?....
    if (
      req.user_fp !== undefined &&
      req.user_fp !== null &&
      req.amount !== undefined &&
      req.amount !== null &&
      req.number !== undefined &&
      req.number !== null &&
      req.expiry !== undefined &&
      req.expiry !== null &&
      req.cvv !== undefined &&
      req.cvv !== null &&
      req.type !== undefined &&
      req.type !== null &&
      req.name !== undefined &&
      req.name !== null &&
      req.city !== undefined &&
      req.city !== null &&
      req.country !== undefined &&
      req.country !== null
    ) {
      let url =
        `${
          /production/i.test(process.env.EVIRONMENT)
            ? `http://${process.env.INSTANCE_PRIVATE_IP}`
            : process.env.LOCAL_URL
        }` +
        ":" +
        process.env.PAYMENT_SERVICE_PORT +
        "/topUPThisWalletTaxiconnect";

      requestAPI({ url, form: req }, function (error, response, body) {
        if (error === null) {
          try {
            body = JSON.parse(body);
            socket.emit("topUp_wallet_io-response", body);
          } catch (error) {
            socket.emit("topUp_wallet_io-response", {
              response: false,
              message: "transaction_error_missing_details",
            });
          }
        } else {
          socket.emit("topUp_wallet_io-response", {
            response: false,
            message: "transaction_error_missing_details",
          });
        }
      });
    } else {
      socket.emit("topUp_wallet_io-response", {
        response: false,
        message: "transaction_error_missing_details",
      });
    }
  });

  /**
   * ACCOUNTS SERVICE, port 9696
   * Route: performDriversReferralOperations
   * event: referralOperations_perform_io
   * Responsible for performing all the referral based operations for any kind of users (riders/drivers).
   */
  socket.on("referralOperations_perform_io", function (req) {
    if (req.user_fingerprint !== undefined && req.user_fingerprint !== null) {
      let url =
        `${
          /production/i.test(process.env.EVIRONMENT)
            ? `http://${process.env.INSTANCE_PRIVATE_IP}`
            : process.env.LOCAL_URL
        }` +
        ":" +
        process.env.ACCOUNTS_SERVICE_PORT +
        "/performDriversReferralOperations?user_fingerprint=" +
        req.user_fingerprint +
        "&user_nature=" +
        req.user_nature +
        "&action=" +
        req.action;
      //Add any additional submissional infos
      if (req.driver_name !== undefined && req.driver_name !== null) {
        url +=
          "&driver_name=" +
          req.driver_name +
          "&driver_phone=" +
          req.driver_phone +
          "&taxi_number=" +
          req.taxi_number;
      }
      //? Add the taxi number only for checking scenarios
      if (/check/i.test(req.action)) {
        url += "&taxi_number=" + req.taxi_number;
      }

      //...
      requestAPI(url, function (error, response, body) {
        if (error === null) {
          try {
            body = JSON.parse(body);
            socket.emit(
              /check/i.test(req.action)
                ? "referralOperations_perform_io_CHECKING-response"
                : /submit/i.test(req.action)
                ? "referralOperations_perform_io_SUBMIT-response"
                : "referralOperations_perform_io-response",
              body
            );
          } catch (error) {
            socket.emit(
              /check/i.test(req.action)
                ? "referralOperations_perform_io_CHECKING-response"
                : /submit/i.test(req.action)
                ? "referralOperations_perform_io_SUBMIT-response"
                : "referralOperations_perform_io-response",
              {
                response: "error_unexpected",
              }
            );
          }
        } else {
          socket.emit(
            /check/i.test(req.action)
              ? "referralOperations_perform_io_CHECKING-response"
              : /submit/i.test(req.action)
              ? "referralOperations_perform_io_SUBMIT-response"
              : "referralOperations_perform_io-response",
            {
              response: "error_unexpected",
            }
          );
        }
      });
    } else {
      socket.emit(
        /check/i.test(req.action)
          ? "referralOperations_perform_io_CHECKING-response"
          : /submit/i.test(req.action)
          ? "referralOperations_perform_io_SUBMIT-response"
          : "referralOperations_perform_io-response",
        {
          response: "error_unexpected",
        }
      );
    }
  });

  /**
   * ! ADMIN APIS only
   */

  /**
   * 1. Get global map projections of all the trips in progress.
   * ? Responsible for getting all the trips in progress in realtime for observation purposes.
   */
  socket.on("getTripsObservabilityStats_io", function (req) {
    if (true) {
      //Do the checkings
      let url =
        `${
          /production/i.test(process.env.EVIRONMENT)
            ? `http://${process.env.INSTANCE_PRIVATE_IP}`
            : process.env.LOCAL_URL
        }` +
        ":" +
        process.env.ANALYTICS_SERVICE_PORT +
        "/getGlobalObservabilityData";

      requestAPI.post({ url, form: req }, function (error, response, body) {
        if (error === null) {
          //Success
          try {
            body = JSON.parse(body);
            socket.emit("getTripsObservabilityStats_io-response", body);
          } catch (error) {
            socket.emit("getTripsObservabilityStats_io-response", {
              response: "error",
              flag: "invalid_data",
            });
          }
        } else {
          socket.emit("getTripsObservabilityStats_io-response", {
            response: "error",
            flag: "invalid_data",
          });
        }
      });
    }
  });

  /**
   * ! DELIVERY WEB APIS
   */
  /**
   * 1. Get global map projections of all the deliveries.
   * ? Responsible for getting all the trips historical data for observation purposes.
   */
  socket.on("getTripsObservabilityStatsDeliveryWeb_io", function (req) {
    if (true) {
      //Do the checkings
      let url =
        `${
          /production/i.test(process.env.EVIRONMENT)
            ? `http://${process.env.INSTANCE_PRIVATE_IP}`
            : process.env.LOCAL_URL
        }` +
        ":" +
        process.env.ANALYTICS_SERVICE_PORT +
        "/getGlobalObservabilityDataDeliverWeb";

      requestAPI.post({ url, form: req }, function (error, response, body) {
        if (error === null) {
          //Success
          try {
            body = JSON.parse(body);
            socket.emit(
              "getTripsObservabilityStatsDeliveryWeb_io-response",
              body
            );
          } catch (error) {
            socket.emit("getTripsObservabilityStatsDeliveryWeb_io-response", {
              response: "error",
              flag: "invalid_data",
            });
          }
        } else {
          socket.emit("getTripsObservabilityStatsDeliveryWeb_io-response", {
            response: "error",
            flag: "invalid_data",
          });
        }
      });
    }
  });
});

server.listen(process.env.EVENT_GATEWAY_PORT);
//dash.monitor({ server: server });
