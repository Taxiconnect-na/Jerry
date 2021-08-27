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
const redis = require("redis");
const client = /production/i.test(String(process.env.EVIRONMENT))
  ? null
  : redis.createClient({
      host: process.env.REDIS_HOST,
      port: process.env.REDIS_PORT,
    });
var RedisClustr = require("redis-clustr");
var redisCluster = /production/i.test(String(process.env.EVIRONMENT))
  ? new RedisClustr({
      servers: [
        {
          host: process.env.REDIS_HOST_ELASTICACHE,
          port: process.env.REDIS_PORT_ELASTICACHE,
        },
      ],
      createClient: function (port, host) {
        // this is the default behaviour
        return redis.createClient(port, host);
      },
    })
  : client;
const redisGet = promisify(redisCluster.get).bind(redisCluster);

var chaineDateUTC = null;
var dateObject = null;
const moment = require("moment");
const { stringify, parse } = require("flatted");

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
 * @func getGlobalObservabilityData
 * Responsible for actively getting the availability data in terms of trips for now
 * @param city: the city to focus the search on
 */
function getGlobalObservabilityData(city = "Windhoek", resolve) {
  let redisKey = `${city}-getGlobalObservabilityData`;

  redisGet(redisKey)
    .then((resp) => {
      if (resp !== null) {
        //Has some record
        try {
          logger.warn("Cached data considered");
          //Rehydrate
          new Promise((resCompute) => {
            execGetGlobalObservabilityData(city, redisKey, resCompute);
          })
            .then(() => {})
            .catch(() => {});
          //...
          resp = JSON.parse(resp);
          resolve(resp);
        } catch (error) {
          logger.error(error);
          resolve({ response: "no_data" });
        }
      } //Do a fresh search
      else {
        new Promise((resCompute) => {
          execGetGlobalObservabilityData(city, redisKey, resCompute);
        })
          .then((result) => {
            resolve(result);
          })
          .catch((error) => {
            logger.error(error);
            resolve({ response: "no_data" });
          });
      }
    })
    .catch((error) => {
      logger.error(error);
      resolve({ response: "no_data" });
    });
}
/**
 * @func execGetGlobalObservabilityData
 * For actively getting the objeservability data
 * @param redisKey: the key to cache the infos at.
 * @param city: the city to focus the search on
 * @pram resolve
 */
function execGetGlobalObservabilityData(city = "Windhoek", redisKey, resolve) {
  //Only for the trips in progress, not confirmed by the driver yet.
  let searchFilter = {
    "pickup_location_infos.city": city,
    "ride_state_vars.isAccepted": true,
    "ride_state_vars.isRideCompleted_driverSide": false,
  };

  //? Get the drivers data
  new Promise((resCompute0) => {
    collectionDrivers_profiles
      .find({
        "operational_state.last_location.city": city,
      })
      .toArray(function (err, driversData) {
        if (err) {
          logger.error(err);
          resCompute0({ response: "no_drivers_data" });
        }
        //...
        if (
          driversData !== undefined &&
          driversData !== null &&
          driversData.length > 0
        ) {
          //Has some data
          //?Form an array of driver_fp, coords, operational state (online/offline), car, and taxi number, and car fp
          let driversBundle = driversData.map((driver) => {
            return {
              driver_fingerprint: driver.driver_fingerprint,
              prev_position:
                driver.operational_state.last_location.prev_coordinates,
              current_position:
                driver.operational_state.last_location.coordinates,
              operational_state: driver.operational_state.status,
              vehicle: {
                car_brand: driver.cars_data[0].car_brand,
                taxi_number: driver.cars_data[0].taxi_number,
                vehicle_type: driver.cars_data[0].vehicle_type,
                car_fingerprint: driver.cars_data[0].car_fingerprint,
              },
            };
          });
          //...
          resCompute0(driversBundle);
        } //No drivers data - strange
        else {
          resCompute0({ response: "no_drivers_data" });
        }
      });
  })
    .then((result) => {
      collectionRidesDeliveries_data
        .find(searchFilter)
        .toArray(function (err, tripsData) {
          if (err) {
            let finalData = {
              drivers: result,
              trips: { response: "no_trips_data" },
            };
            redisCluster.setex(
              redisKey,
              parseInt(process.env.REDIS_EXPIRATION_5MIN) * 5,
              JSON.stringify(finalData)
            );
            resolve(finalData);
          }
          //...
          if (
            tripsData !== undefined &&
            tripsData !== null &&
            tripsData.length > 0
          ) {
            let finalData = { drivers: result, trips: { response: tripsData } };
            new Promise((resCache) => {
              redisCluster.setex(
                redisKey,
                parseInt(process.env.REDIS_EXPIRATION_5MIN) * 5,
                JSON.stringify(finalData)
              );
              resCache(true);
            })
              .then()
              .catch();
            //...
            resolve({ drivers: result, trips: { response: tripsData } });
          } //No trips data - strange
          else {
            let finalData = {
              drivers: result,
              trips: { response: "no_trips_data" },
            };
            redisCluster.setex(
              redisKey,
              parseInt(process.env.REDIS_EXPIRATION_5MIN) * 5,
              JSON.stringify(finalData)
            );
            //...
            resolve(finalData);
          }
        });
    })
    .catch((error) => {
      logger.error(error);
      let finalData = { response: "no_data" };
      new Promise((resCache) => {
        redisCluster.setex(
          redisKey,
          parseInt(process.env.REDIS_EXPIRATION_5MIN) * 5,
          JSON.stringify(finalData)
        );
        resCache(true);
      })
        .then()
        .catch();
      resolve(finalData);
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
          logger.info("[+] Analytics services active.");
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
          collectionDrivers_profiles = dbMongo.collection("drivers_profiles"); //Hold all the drivers profiles
          collectionPassengers_profiles = dbMongo.collection(
            "passengers_profiles"
          ); //Hold all the passengers profiles.
          collectionGlobalEvents = dbMongo.collection("global_events"); //Hold all the random events that happened somewhere.
          collectionWalletTransactions_logs = dbMongo.collection(
            "wallet_transactions_logs"
          ); //Hold the latest information about the riders topups
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

          /**
           * GET GENERAL OBSERVABILITY DATA
           *? Responsible for getting all the data in motion that will reflect the current or historical
           *? state of the all network.
           * REDIS propertiy
           */
          app.post("/getGlobalObservabilityData", function (req, res) {
            new Promise((resMAIN) => {
              let request = req.body;

              getGlobalObservabilityData("Windhoek", resMAIN);
            })
              .then((result) => {
                res.send(result);
              })
              .catch((error) => {
                logger.error(error);
                res.send(false);
              });
          });
        }
      );
    }
  );
});
server.listen(process.env.ANALYTICS_SERVICE_PORT);
//dash.monitor({ server: server });
