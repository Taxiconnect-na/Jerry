require("dotenv").config();
//require("newrelic");
//var dash = require("appmetrics-dash");
var express = require("express");
const http = require("http");
const fs = require("fs");
const MongoClient = require("mongodb").MongoClient;
const certFile = fs.readFileSync("./rds-combined-ca-bundle.pem");

const { logger } = require("./LogService");

var app = express();
var server = http.createServer(app);
const helmet = require("helmet");
const requestAPI = require("request");
//....
const { promisify, inspect } = require("util");
const urlParser = require("url");

const { redisCluster, redisGet } = require("./RedisConnector");

var chaineDateUTC = null;
var dateObject = null;
const moment = require("moment");
const { stringify, parse } = require("flatted");
const { resolve } = require("path");

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
 * @func cacheTheDataOrderly
 * Responsible for caching the collection data in order and dynamically.
 * @param collectionData: the instance of the instance that is to be cached
 * @param collectionData_name: the name of the instance that is to be cached to be used as redisKey
 * @param isHex_cache: whether or not the cached data is to expire.
 * @param expiration: the expiration time for the cached data.
 * @param resolve
 */
function cacheTheDataOrderly(
  collectionData,
  collectionData_name,
  isHex_cache = false,
  expiration = parseInt(process.env.REDIS_EXPIRATION_5MIN) * 100,
  resolve
) {
  logger.warn(`About to cache the collection -> ${collectionData_name}`);
  //! 1. Get the data to be cached
  collectionData.find({}).toArray(function (err, dataToBeCached) {
    if (err) {
      logger.error(err);
      resolve({ response: "unable to cache the data" });
    }
    //...
    if (dataToBeCached !== undefined && dataToBeCached.length > 0) {
      //Has some data
      dataToBeCached = JSON.stringify(dataToBeCached);
      //...
      if (isHex_cache === false) {
        //Normal cache
        redisCluster.set(collectionData_name, dataToBeCached);
        resolve({ response: "cached" });
      } //Cached data
      else {
        redisCluster.setex(collectionData_name, expiration, dataToBeCached);
        resolve({ response: "cached" });
      }
    } //No data to be cached
    else {
      resolve({ response: "no_data_tobe_cached" });
    }
  });
}

/**
 * MAIN
 */
var collectionRidesDeliveries_data = null;
var collectionRelativeDistances = null;
var collectionRidersLocation_log = null;
var collectionDrivers_profiles = null;
var collectionGlobalEvents = null;
var collectionWalletTransactions_logs = null;
var collectionDedicatedServices_accounts = null;
var collectionHistoricalGPS = null;
var collectionPassengers_profiles = null;

redisCluster.on("connect", function () {
  //logger.info("[*] Redis connected");
  requestAPI(
    /development/i.test(process.env.EVIRONMENT)
      ? `${process.env.AUTHENTICATOR_URL}get_API_CRED_DATA?environment=dev_local` //? Development localhost url
      : /production/i.test(process.env.EVIRONMENT)
      ? /live/i.test(process.env.SERVER_TYPE)
        ? `${process.env.AUTHENTICATOR_URL}get_API_CRED_DATA?environment=production` //? Live production url
        : `${process.env.AUTHENTICATOR_URL}get_API_CRED_DATA?environment=dev_production` //? Dev live testing url
      : `${process.env.AUTHENTICATOR_URL}get_API_CRED_DATA?environment=dev_local`, //?Fall back url
    function (error, response, body) {
      body = JSON.parse(body);
      //...
      process.env.AWS_S3_ID = body.AWS_S3_ID;
      process.env.AWS_S3_SECRET = body.AWS_S3_SECRET;
      process.env.URL_MONGODB_DEV = body.URL_MONGODB_DEV;
      process.env.URL_MONGODB_PROD = body.URL_MONGODB_PROD;

      MongoClient.connect(
        /live/i.test(process.env.SERVER_TYPE)
          ? process.env.URL_MONGODB_PROD
          : process.env.URL_MONGODB_DEV,
        /production/i.test(process.env.EVIRONMENT)
          ? {
              tlsCAFile: certFile, //The DocDB cert
              useUnifiedTopology: true,
              useNewUrlParser: true,
            }
          : {
              useUnifiedTopology: true,
              useNewUrlParser: true,
            },
        function (err, clientMongo) {
          if (err) throw err;

          //if (err) throw err;
          logger.info("[+] Smart cacher services active.");
          const dbMongo = clientMongo.db(process.env.DB_NAME_MONGODDB);
          collectionRidesDeliveries_data = dbMongo.collection(
            "rides_deliveries_requests"
          ); //Hold all the requests made (rides and deliveries)
          collectionRelativeDistances = dbMongo.collection(
            "relative_distances_riders_drivers"
          ); //Hold the relative distances between rider and the drivers (online, same city, same country) at any given time
          collectionRidersLocation_log = dbMongo.collection(
            "historical_positioning_logs"
          ); //Hold all the location updated from the rider
          collectionHistoricalGPS = dbMongo.collection(
            "historical_gps_positioning"
          ); //Hold all the GPS updates from the rider or driver
          collectionDrivers_profiles = dbMongo.collection("drivers_profiles"); //Hold all the drivers profiles
          collectionPassengers_profiles = dbMongo.collection(
            "passengers_profiles"
          ); //Hold all the passengers profiles.
          collectionGlobalEvents = dbMongo.collection("global_events"); //Hold all the random events that happened somewhere.
          collectionWalletTransactions_logs = dbMongo.collection(
            "wallet_transactions_logs"
          ); //Hold the latest information about the riders topups
          collectionDedicatedServices_accounts = dbMongo.collection(
            "dedicated_services_accounts"
          ); //Hold all the accounts for dedicated servics like deliveries, etc.
          //-------------
          app
            .get("/", function (req, res) {
              res.send("Map services up");
            })
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
            .use(helmet());

          //! OBSERVATORS
          //! 1. collectionWalletTransactions_logs
          // let stream_collectionWalletTransactions_logs =
          //   collectionWalletTransactions_logs.watch();
          // stream_collectionWalletTransactions_logs.on("change", (next) => {
          //   // process any change event
          //   if (
          //     next.operationType === "insert" ||
          //     next.operationType === "delete" ||
          //     next.operationType === "update"
          //   ) {
          //     if (next.operationType === "update") {
          //       //Restrict updates
          //       if (
          //         next.updateDescription.updatedFields.recipient_fp !==
          //           undefined &&
          //         next.updateDescription.updatedFields.recipient_fp !== null
          //       ) {
          //         //Do the operations
          //         new Promise((resolve) => {
          //           cacheTheDataOrderly(
          //             collectionWalletTransactions_logs,
          //             "collectionWalletTransactions_logs",
          //             false,
          //             null,
          //             resolve
          //           );
          //         })
          //           .then((result) => logger.info(result))
          //           .catch((error) => logger.error(error));
          //       } else {
          //         // logger.info("Skip the change");
          //       }
          //     } //Do the operation
          //     else {
          //       new Promise((resolve) => {
          //         cacheTheDataOrderly(
          //           collectionWalletTransactions_logs,
          //           "collectionWalletTransactions_logs",
          //           false,
          //           null,
          //           resolve
          //         );
          //       })
          //         .then((result) => logger.info(result))
          //         .catch((error) => logger.error(error));
          //     }
          //   }
          // });

          // //! 2. collectionRidesDeliveries_data
          // let stream_collectionRidesDeliveries_data =
          //   collectionRidesDeliveries_data.watch();
          // stream_collectionRidesDeliveries_data.on("change", (next) => {
          //   // process any change event
          //   if (
          //     next.operationType === "insert" ||
          //     next.operationType === "delete" ||
          //     next.operationType === "update"
          //   ) {
          //     console.log(next);
          //     new Promise((resolve) => {
          //       cacheTheDataOrderly(
          //         collectionRidesDeliveries_data,
          //         "collectionRidesDeliveries_data",
          //         false,
          //         null,
          //         resolve
          //       );
          //     })
          //       .then((result) => logger.info(result))
          //       .catch((error) => logger.error(error));
          //   }
          // });

          // //! 3. collectionDrivers_profiles
          // let stream_collectionDrivers_profiles =
          //   collectionDrivers_profiles.watch();
          // stream_collectionDrivers_profiles.on("change", (next) => {
          //   // process any change event
          //   if (
          //     next.operationType === "insert" ||
          //     next.operationType === "delete" ||
          //     next.operationType === "update"
          //   ) {
          //     new Promise((resolve) => {
          //       cacheTheDataOrderly(
          //         collectionDrivers_profiles,
          //         "collectionDrivers_profiles",
          //         false,
          //         null,
          //         resolve
          //       );
          //     })
          //       .then((result) => logger.info(result))
          //       .catch((error) => logger.error(error));
          //   }
          // });

          // //! 4. collectionPassengers_profiles
          // let stream_collectionPassengers_profiles =
          //   collectionPassengers_profiles.watch();
          // stream_collectionPassengers_profiles.on("change", (next) => {
          //   // process any change event
          //   if (
          //     next.operationType === "insert" ||
          //     next.operationType === "delete" ||
          //     next.operationType === "update"
          //   ) {
          //     new Promise((resolve) => {
          //       cacheTheDataOrderly(
          //         collectionPassengers_profiles,
          //         "collectionPassengers_profiles",
          //         false,
          //         null,
          //         resolve
          //       );
          //     })
          //       .then((result) => logger.info(result))
          //       .catch((error) => logger.error(error));
          //   }
          // });
        }
      );
    }
  );
});

server.listen(process.env.SMART_CACHER_SERVICE_PORT);
