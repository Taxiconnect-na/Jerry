require("dotenv").config();
//require("newrelic");
//var dash = require("appmetrics-dash");
var express = require("express");
const http = require("http");
const fs = require("fs");

const { logger } = require("./LogService");

var app = express();
var server = http.createServer(app);
const crypto = require("crypto");
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

//! Attach DynamoDB helper
const {
  dynamo_insert,
  dynamo_update,
  dynamo_find_query,
  dynamo_delete,
  dynamo_get_all,
  dynamo_find_get,
} = require("./DynamoServiceManager");

var chaineDateUTC = null;
var dateObject = null;
const moment = require("moment");
const { stringify, parse } = require("flatted");
const { resolvePtr } = require("dns");

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

  resolve({ response: "no_data" });

  // redisGet(redisKey)
  //   .then((resp) => {
  //     if (resp !== null) {
  //       //Has some record
  //       try {
  //         logger.warn("Cached data considered");
  //         //Rehydrate
  //         new Promise((resCompute) => {
  //           execGetGlobalObservabilityData(city, redisKey, resCompute);
  //         })
  //           .then(() => {})
  //           .catch(() => {});
  //         //...
  //         resp = JSON.parse(resp);
  //         resolve(resp);
  //       } catch (error) {
  //         logger.error(error);
  //         resolve({ response: "no_data" });
  //       }
  //     } //Do a fresh search
  //     else {
  //       new Promise((resCompute) => {
  //         execGetGlobalObservabilityData(city, redisKey, resCompute);
  //       })
  //         .then((result) => {
  //           resolve(result);
  //         })
  //         .catch((error) => {
  //           logger.error(error);
  //           resolve({ response: "no_data" });
  //         });
  //     }
  //   })
  //   .catch((error) => {
  //     logger.error(error);
  //     resolve({ response: "no_data" });
  //   });
}

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
  } //Other - default - for creating accounts.
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
 * @func execGetGlobalObservabilityData
 * For actively getting the objeservability data
 * @param redisKey: the key to cache the infos at.
 * @param city: the city to focus the search on
 * @pram resolve
 */
function execGetGlobalObservabilityData(city = "Windhoek", redisKey, resolve) {
  //Only for the trips in progress, not confirmed by the driver yet.
  // let searchFilter = {
  //   "pickup_location_infos.city": city,
  //   "ride_state_vars.isAccepted": true,
  //   "ride_state_vars.isRideCompleted_driverSide": false,
  // };
  // //? Get the drivers data
  // new Promise((resCompute0) => {
  //   collectionDrivers_profiles
  //     .f\ind({
  //       "operational_state.last_location.city": city,
  //     })
  //     .toArray(function (err, driversData) {
  //       if (err) {
  //         logger.error(err);
  //         resCompute0({ response: "no_drivers_data" });
  //       }
  //       //...
  //       if (
  //         driversData !== undefined &&
  //         driversData !== null &&
  //         driversData.length > 0
  //       ) {
  //         //Has some data
  //         //?Form an array of driver_fp, coords, operational state (online/offline), car, and taxi number, and car fp
  //         let driversBundle = driversData.map((driver) => {
  //           return {
  //             driver_fingerprint: driver.driver_fingerprint,
  //             prev_position:
  //               driver.operational_state.last_location.prev_coordinates,
  //             current_position:
  //               driver.operational_state.last_location.coordinates,
  //             operational_state: driver.operational_state.status,
  //             vehicle: {
  //               car_brand: driver.cars_data[0].car_brand,
  //               taxi_number: driver.cars_data[0].taxi_number,
  //               vehicle_type: driver.cars_data[0].vehicle_type,
  //               car_fingerprint: driver.cars_data[0].car_fingerprint,
  //             },
  //           };
  //         });
  //         //...
  //         resCompute0(driversBundle);
  //       } //No drivers data - strange
  //       else {
  //         resCompute0({ response: "no_drivers_data" });
  //       }
  //     });
  // })
  //   .then((result) => {
  //     collectionRidesDeliveries_data
  //       .fi\nd(searchFilter)
  //       .toArray(function (err, tripsData) {
  //         if (err) {
  //           let finalData = {
  //             drivers: result,
  //             trips: { response: "no_trips_data" },
  //           };
  //           redisCluster.setex(
  //             redisKey,
  //             parseInt(process.env.REDIS_EXPIRATION_5MIN) * 5,
  //             JSON.stringify(finalData)
  //           );
  //           resolve(finalData);
  //         }
  //         //...
  //         if (
  //           tripsData !== undefined &&
  //           tripsData !== null &&
  //           tripsData.length > 0
  //         ) {
  //           let finalData = { drivers: result, trips: { response: tripsData } };
  //           new Promise((resCache) => {
  //             redisCluster.setex(
  //               redisKey,
  //               parseInt(process.env.REDIS_EXPIRATION_5MIN) * 5,
  //               JSON.stringify(finalData)
  //             );
  //             resCache(true);
  //           })
  //             .then()
  //             .catch();
  //           //...
  //           resolve({ drivers: result, trips: { response: tripsData } });
  //         } //No trips data - strange
  //         else {
  //           let finalData = {
  //             drivers: result,
  //             trips: { response: "no_trips_data" },
  //           };
  //           redisCluster.setex(
  //             redisKey,
  //             parseInt(process.env.REDIS_EXPIRATION_5MIN) * 5,
  //             JSON.stringify(finalData)
  //           );
  //           //...
  //           resolve(finalData);
  //         }
  //       });
  //   })
  //   .catch((error) => {
  //     logger.error(error);
  //     let finalData = { response: "no_data" };
  //     new Promise((resCache) => {
  //       redisCluster.setex(
  //         redisKey,
  //         parseInt(process.env.REDIS_EXPIRATION_5MIN) * 5,
  //         JSON.stringify(finalData)
  //       );
  //       resCache(true);
  //     })
  //       .then()
  //       .catch();
  //     resolve(finalData);
  //   });
}

/**
 * @func getObservabilityDataForDeliveryWeb
 * responsible for getting the observability data for the web delivery interface.
 * @param requestData: the bundle containing all the requested information
 * @param resolve
 */
function getObservabilityDataForDeliveryWeb(requestData, resolve) {
  //Check in redis
  let redisKey = `${requestData.user_fp}-observabilityDataWebInterface`;
  logger.warn("HERE");

  redisGet(redisKey).then((resp) => {
    if (resp !== null) {
      //Found some cached data
      try {
        //Rehydate
        logger.warn("Found cached data for delivery web observability data");
        new Promise((resCompute) => {
          execGetObservabilityDataForDeliveryWeb(requestData, resCompute);
        })
          .then((result) => {
            //Cache
            new Promise((resCache) => {
              redisCluster.setex(
                redisKey,
                parseInt(process.env.REDIS_EXPIRATION_5MIN) * 1440,
                JSON.stringify(result)
              );
              resCache(true);
            })
              .then()
              .catch();
          })
          .catch((error) => {
            logger.error(error);
            resolve({ response: "error" });
          });
        //...
        resp = JSON.parse(resp);
        resolve(resp);
      } catch (error) {
        logger.error(error);
        logger.warn("Getting fresh observability data for the delivery web");
        new Promise((resCompute) => {
          execGetObservabilityDataForDeliveryWeb(requestData, resCompute);
        })
          .then((result) => {
            //Cache
            new Promise((resCache) => {
              redisCluster.setex(
                redisKey,
                parseInt(process.env.REDIS_EXPIRATION_5MIN) * 1440,
                JSON.stringify(result)
              );
              resCache(true);
            })
              .then()
              .catch();
            //...
            resolve(result);
          })
          .catch((error) => {
            logger.error(error);
            resolve({ response: "error" });
          });
      }
    } //No cached data - get some fresh records
    else {
      logger.warn("Getting fresh observability data for the delivery web");
      new Promise((resCompute) => {
        execGetObservabilityDataForDeliveryWeb(requestData, resCompute);
      })
        .then((result) => {
          //Cache
          new Promise((resCache) => {
            redisCluster.setex(
              redisKey,
              parseInt(process.env.REDIS_EXPIRATION_5MIN) * 1440,
              JSON.stringify(result)
            );
            resCache(true);
          })
            .then()
            .catch((error) => logger.error(error));
          //...
          resolve(result);
        })
        .catch((error) => {
          logger.error(error);
          resolve({ response: "error" });
        });
    }
  });
}

/**
 * @func getWeekNumber
 * Responsible for getting the week number for any specific date.
 * @param d: the date object
 */
function getWeekNumber(d) {
  // Copy date so don't modify original
  d = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  // Set to nearest Thursday: current date + 4 - current day number
  // Make Sunday's day number 7
  d.setUTCDate(d.getUTCDate() + 4 - (d.getUTCDay() || 7));
  // Get first day of year
  var yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  // Calculate full weeks to nearest Thursday
  var weekNo = Math.ceil(((d - yearStart) / 86400000 + 1) / 7);
  // Return array of year and week number
  return [d.getUTCFullYear(), weekNo];
}

/**
 * @func execGetObservabilityDataForDeliveryWeb
 * Responsible for actively getting the observability data for the web delivery interface
 * @param requestData: the bundle containing all the requested information
 * @param resolve
 */
function execGetObservabilityDataForDeliveryWeb(requestData, resolve) {
  //? Array fixed base suburbs
  let arrayFixedBaseSuburbs = {
    Academia: "Academia",
    Auasblick: "Auasblik",
    Auasblik: "Auasblik",
    Avis: "Avis",
    "Big Bend": "Big Bend",
    Brakwater: "Brakwater",
    Cimbebasia: "Cimbebasia",
    "Dorado Park": "Dorado Park",
    Eros: "Eros",
    "Eros Park": "Eros Park",
    Goreangab: "Goreangab",
    "Greenwell Matongo": "Greenwell Matongo",
    Hakahana: "Hakahana",
    Havana: "Havana",
    "Hochland Park": "Hochland Park",
    Hochlandpark: "Hochland Park",
    "Informal settlements": "Informal settlements",
    Katutura: "Katutura",
    Khomasdal: "Khomasdal",
    "Kilimanjaro Informal Settlement": "Kilimanjaro Informal Settlement",
    "Klein Windhoek": "Klein Windhoek",
    "Lafrenz Industrial": "Lafrenz Industrial",
    Ludwigsdorf: "Ludwigsdorf",
    "Luxury Hill": "Luxury Hill",
    "Northern Industrial": "Northern Industrial",
    Okuryangava: "Okuryangava",
    Olympia: "Olympia",
    Otjomuise: "Otjomuise",
    "Pioneers Park": "Pioneers Park",
    Pionierspark: "Pioneers Park",
    "Prosperita Industrial": "Prosperita Industrial",
    Prosperita: "Prosperita Industrial",
    "Rocky Crest": "Rocky Crest",
    Wanaheda: "Wanaheda",
    "Samora Machel Constituency": "Wanaheda",
    "Southern Industrial Area": "Southern Industrial Area",
    Suiderhof: "Suiderhof",
    "Tauben Glen": "Tauben Glen",
    "Windhoek Central / CBD": "Windhoek Central / CBD",
    "Windhoek Central": "Windhoek Central / CBD",
    "Windhoek North": "Windhoek North",
    "Windhoek West": "Windhoek West",
  };

  let modelMetaDataResponse = {
    genericGlobalStats: {
      tripInsight: {
        total_deliveries: 0, //Done
        total_successful_deliveries: 0, //Done
        total_cancelled_deliveries: 0, //Done
        total_served_receivers: 0, //Done
      },
      financialInsights: {
        total_spent: 0, //Done
        total_spent_successful_del: 0, //Done
        total_spent_cancelled_del: 0,
      },
    },
    daily_view: {}, //Daily summary of the selected day zoom
    weekly_view: {}, //weekly summary of the selected day zoom
    monthly_view: {}, //monthly summary of the selected day zoom
    yearly_view: {}, //yearly summary of the selected day zoom
    drivers_view: {}, //drivers summary of the selected day zoom
    riders_view: {}, //riders summary of the selected day zoom
    //...Traffic per suburbs
    busiest_pickup_suburbs: {},
    busiest_destination_suburbs: {},
  };

  dynamo_find_query({
    table_name: "dedicated_services_accounts",
    IndexName: "company_fp",
    KeyConditionExpression: "company_fp = :val1",
    ExpressionAttributeValues: {
      ":val1": requestData.user_fp,
    },
  })
    .then((companyData) => {
      if (companyData !== undefined && companyData.length > 0) {
        //Valid company
        companyData = companyData[0];
        //...
        //Get the rides history data
        //!.sort({ date_requested: -1 })

        dynamo_find_query({
          table_name: "rides_deliveries_requests",
          IndexName: "client_id",
          KeyConditionExpression: "client_id = :val1",
          ExpressionAttributeValues: {
            ":val1": requestData.user_fp,
          },
        })
          .then((tripData) => {
            if (tripData !== undefined && tripData.length > 0) {
              //Found some trips
              modelMetaDataResponse.genericGlobalStats.tripInsight.total_deliveries =
                tripData.length; //Get all the successful trips
              modelMetaDataResponse.genericGlobalStats.tripInsight.total_successful_deliveries =
                tripData.length; //Get all the successful trips
              //...
              tripData.map((trip) => {
                modelMetaDataResponse.genericGlobalStats.financialInsights.total_spent +=
                  parseFloat(trip.fare); //Successful fares
                modelMetaDataResponse.genericGlobalStats.financialInsights.total_spent_successful_del +=
                  parseFloat(trip.fare); //Successful fares
                modelMetaDataResponse.genericGlobalStats.tripInsight.total_served_receivers +=
                  trip.destinationData.length;

                //? 1. Get the daily_view stats - successful rides
                let day_date_argument = new Date(trip.date_requested)
                  .toLocaleString()
                  .split(", ")[0];

                modelMetaDataResponse.daily_view = getInsightStats(
                  trip,
                  day_date_argument,
                  modelMetaDataResponse.daily_view,
                  "successful"
                );

                //? 2. Get the weekly_view stats - successful rides
                //Week number - year
                let week_number_argument = `${
                  getWeekNumber(new Date(trip.date_requested))[1]
                }-${getWeekNumber(new Date(trip.date_requested))[0]}`;

                modelMetaDataResponse.weekly_view = getInsightStats(
                  trip,
                  week_number_argument,
                  modelMetaDataResponse.weekly_view,
                  "successful"
                );

                //? 3. Get the monthly_view stats - successful rides
                //Month number - year
                let month_number_argument = `${
                  new Date(trip.date_requested).getMonth() + 1
                }-${new Date(trip.date_requested).getFullYear()}`;

                modelMetaDataResponse.monthly_view = getInsightStats(
                  trip,
                  month_number_argument,
                  modelMetaDataResponse.monthly_view,
                  "successful"
                );

                //? 4. Get the yearly_view stats - successful rides
                //Year number
                let year_number_argument = new Date(
                  trip.date_requested
                ).getFullYear();

                modelMetaDataResponse.yearly_view = getInsightStats(
                  trip,
                  year_number_argument,
                  modelMetaDataResponse.yearly_view,
                  "successful"
                );

                //? 7. Get the busiest_pickup_suburbs stats - successful rides
                //user_fp
                let pickup_number_argument =
                  arrayFixedBaseSuburbs[trip.pickup_location_infos.suburb] !==
                    undefined &&
                  arrayFixedBaseSuburbs[trip.pickup_location_infos.suburb] !==
                    null
                    ? arrayFixedBaseSuburbs[
                        trip.pickup_location_infos.suburb
                      ] !== undefined &&
                      arrayFixedBaseSuburbs[trip.pickup_location_infos.suburb]
                    : trip.pickup_location_infos.suburb;

                modelMetaDataResponse.busiest_pickup_suburbs = getInsightStats(
                  trip,
                  pickup_number_argument,
                  modelMetaDataResponse.busiest_pickup_suburbs,
                  "successful"
                );

                //? 8. Get the busiest_destination_suburbs stats - successful rides
                trip.destinationData.map((destination) => {
                  //user_fp
                  let destination_number_argument =
                    arrayFixedBaseSuburbs[destination.suburb] !== undefined &&
                    arrayFixedBaseSuburbs[destination.suburb] !== null
                      ? arrayFixedBaseSuburbs[destination.suburb]
                      : destination.suburb;

                  modelMetaDataResponse.busiest_destination_suburbs =
                    getInsightStats(
                      trip,
                      destination_number_argument,
                      modelMetaDataResponse.busiest_destination_suburbs,
                      "successful"
                    );
                });
              });
              //...
              //? Get all the cancellled trips
              //! .sort({ date_requested: -1 })
              dynamo_find_query({
                table_name: "cancelled_rides_deliveries_requests",
                IndexName: "client_id",
                KeyConditionExpression: "client_id = :val1",
                ExpressionAttributeValues: {
                  ":val1": requestData.user_fp,
                },
              })
                .then((cancelledTripData) => {
                  logger.error(JSON.stringify(cancelledTripData));
                  //...
                  if (
                    cancelledTripData !== undefined &&
                    cancelledTripData.length > 0
                  ) {
                    //Found some trips
                    modelMetaDataResponse.genericGlobalStats.tripInsight.total_deliveries +=
                      cancelledTripData.length; //Get all the cancelled trips
                    modelMetaDataResponse.genericGlobalStats.tripInsight.total_cancelled_deliveries =
                      cancelledTripData.length; //Get all the cancelled trips
                    //...
                    cancelledTripData.map((trip) => {
                      modelMetaDataResponse.genericGlobalStats.financialInsights.total_spent +=
                        parseFloat(trip.fare); //Successful fares
                      modelMetaDataResponse.genericGlobalStats.financialInsights.total_spent_cancelled_del +=
                        parseFloat(trip.fare); //Cancelled fares
                      modelMetaDataResponse.genericGlobalStats.tripInsight.total_served_receivers +=
                        trip.destinationData.length;

                      //? 1. Get the daily_view stats - cancelled rides
                      let day_date_argument = new Date(trip.date_requested)
                        .toLocaleString()
                        .split(", ")[0];

                      modelMetaDataResponse.daily_view = getInsightStats(
                        trip,
                        day_date_argument,
                        modelMetaDataResponse.daily_view,
                        "cancelled"
                      );

                      //? 2. Get the weekly_view stats - cancelled rides
                      //Week number - year
                      let week_number_argument = `${
                        getWeekNumber(new Date(trip.date_requested))[1]
                      }-${getWeekNumber(new Date(trip.date_requested))[0]}`;

                      modelMetaDataResponse.weekly_view = getInsightStats(
                        trip,
                        week_number_argument,
                        modelMetaDataResponse.weekly_view,
                        "cancelled"
                      );

                      //? 3. Get the monthly_view stats - cancelled rides
                      //Month number - year
                      let month_number_argument = `${
                        new Date(trip.date_requested).getMonth() + 1
                      }-${new Date(trip.date_requested).getFullYear()}`;

                      modelMetaDataResponse.monthly_view = getInsightStats(
                        trip,
                        month_number_argument,
                        modelMetaDataResponse.monthly_view,
                        "cancelled"
                      );

                      //? 4. Get the yearly_view stats - cancelled rides
                      //Year number
                      let year_number_argument = new Date(
                        trip.date_requested
                      ).getFullYear();

                      modelMetaDataResponse.yearly_view = getInsightStats(
                        trip,
                        year_number_argument,
                        modelMetaDataResponse.yearly_view,
                        "cancelled"
                      );

                      //? 7. Get the busiest_pickup_suburbs stats - successful rides
                      //user_fp
                      let pickup_number_argument =
                        arrayFixedBaseSuburbs[
                          trip.pickup_location_infos.suburb
                        ] !== undefined &&
                        arrayFixedBaseSuburbs[
                          trip.pickup_location_infos.suburb
                        ] !== null
                          ? arrayFixedBaseSuburbs[
                              trip.pickup_location_infos.suburb
                            ] !== undefined &&
                            arrayFixedBaseSuburbs[
                              trip.pickup_location_infos.suburb
                            ]
                          : trip.pickup_location_infos.suburb;

                      modelMetaDataResponse.busiest_pickup_suburbs =
                        getInsightStats(
                          trip,
                          pickup_number_argument,
                          modelMetaDataResponse.busiest_pickup_suburbs,
                          "cancelled"
                        );

                      //? 8. Get the busiest_destination_suburbs stats - successful rides
                      trip.destinationData.map((destination) => {
                        //user_fp
                        let destination_number_argument =
                          arrayFixedBaseSuburbs[destination.suburb] !==
                            undefined &&
                          arrayFixedBaseSuburbs[destination.suburb] !== null
                            ? arrayFixedBaseSuburbs[destination.suburb]
                            : destination.suburb;

                        modelMetaDataResponse.busiest_destination_suburbs =
                          getInsightStats(
                            trip,
                            destination_number_argument,
                            modelMetaDataResponse.busiest_destination_suburbs,
                            "cancelled"
                          );
                      });
                    });
                    //?DONE
                    resolve({
                      response: "success",
                      data: modelMetaDataResponse,
                    });
                  } //No cancelled data
                  else {
                    resolve({
                      response: "success",
                      data: modelMetaDataResponse,
                    });
                  }
                })
                .catch((error) => {
                  logger.error(error);
                  resolve({
                    response: "success",
                    data: modelMetaDataResponse,
                  });
                });
            } //no trips
            else {
              resolve({ response: "no_data" });
            }
          })
          .catch((error) => {
            logger.error(error);
            resolve({ response: "error" });
          });
      } //Unknown company
      else {
        resolve({ response: "error" });
      }
    })
    .catch((error) => {
      logger.error(error);
      resolve({ response: "error" });
    });
}

/**
 * @func getDailyStats
 * Responsible for packing an processing daily, weekly, monthly, yearly, suburb based or any kind of similarly structured stats
 * @param trip: basic trip data object: successful/cancelled
 * @param day_date_argument: the object argument of the daily view
 * @param modelMetaDataResponseTargeted: the specific object child to modify
 * @param natureTrip: successful or cancelled
 */
function getInsightStats(
  trip,
  day_date_argument,
  modelMetaDataResponseTargeted,
  natureTrip
) {
  modelMetaDataResponseTargeted[day_date_argument] =
    modelMetaDataResponseTargeted[day_date_argument] !== undefined &&
    modelMetaDataResponseTargeted[day_date_argument] !== null
      ? modelMetaDataResponseTargeted[day_date_argument]
      : {
          date_refs: [],
          total_trips: 0, //? Done
          total_successful_trips: 0, //?Done
          total_cancelled_trips: 0, //?Done
          total_connectme_trips: 0, //?Done
          total_connectus_trips: 0, //?Done
          total_scheduled_trips: 0, //?Done
          total_immediate_trips: 0, //? Done
          total_cash_trips: 0, //?Done
          total_wallet_trips: 0, //?done
          //...rides
          total_successful_rides: 0, //?done
          total_cancelled_rides: 0, //?Done
          total_successful_immediate_rides: 0, //?Done
          total_successful_scheduled_rides: 0, //?Done
          total_cancelled_immediate_rides: 0, //?Done
          total_cancelled_scheduled_rides: 0, //?Done
          total_successful_connectme_rides: 0, //?Done
          total_cancelled_connectme_rides: 0, //?Done
          total_successful_connectus_rides: 0, //?Done
          total_cancelled_connectus_rides: 0, //?Done
          total_successful_cash_rides: 0, //?Done
          total_cancelled_cash_rides: 0, //?Done
          total_successful_wallet_rides: 0, //?Done
          total_cancelled_wallet_rides: 0, //?Done
          //...deliveries
          total_successful_deliveries: 0, //?Done
          total_cancelled_deliveries: 0, //?Done
          total_successful_immediate_deliveries: 0, //?Done
          total_successful_scheduled_deliveries: 0, //?Done
          total_cancelled_immediate_deliveries: 0, //?Done
          total_cancelled_scheduled_deliveries: 0, //?Done
          total_successful_cash_deliveries: 0, //?Done
          total_cancelled_cash_deliveries: 0, //?Done
          total_successful_wallet_deliveries: 0, //?Done
          total_cancelled_wallet_deliveries: 0, //?Done
          //...Handling
          percentage_trip_handling: 0, //success/total * 100%
          percentage_rides_handling: 0,
          percentage_deliveries_handling: 0,
          //...drivers/riders
          total_riders: 0,
          total_drivers: 0,
          riders_to_drivers_ratio: 0,
          //...Commission
          total_commission: 0, //Generated by rides during zoom period
          total_commission_collected: 0,
          total_commission_pending: 0,
        };

  if (/successful/i.test(natureTrip)) {
    //successful trips
    modelMetaDataResponseTargeted[day_date_argument].date_refs.push(
      new Date(trip.date_requested)
    );
    modelMetaDataResponseTargeted[day_date_argument].total_trips += 1;
    modelMetaDataResponseTargeted[
      day_date_argument
    ].total_successful_trips += 1;
    //? -------------------------------------------------------------------
    if (/RIDE/i.test(trip.ride_mode)) {
      //Ride
      modelMetaDataResponseTargeted[
        day_date_argument
      ].total_successful_rides += 1;
    } else if (/DELIVERY/i.test(trip.ride_mode)) {
      //Delivery
      modelMetaDataResponseTargeted[
        day_date_argument
      ].total_successful_deliveries += 1;
    }
    //...
    if (/connectme/i.test(trip.connect_type)) {
      //Connectme
      modelMetaDataResponseTargeted[
        day_date_argument
      ].total_connectme_trips += 1;
      if (/RIDE/i.test(trip.ride_mode)) {
        //Ride
        modelMetaDataResponseTargeted[
          day_date_argument
        ].total_successful_connectme_rides += 1;
      }
    } //ConnectUs
    else {
      modelMetaDataResponseTargeted[
        day_date_argument
      ].total_connectus_trips += 1;
      if (/RIDE/i.test(trip.ride_mode)) {
        //Ride
        modelMetaDataResponseTargeted[
          day_date_argument
        ].total_successful_connectus_rides += 1;
      }
    }
    //...Schedule
    if (/scheduled/i.test(trip.request_type)) {
      //Scheduled rides
      modelMetaDataResponseTargeted[
        day_date_argument
      ].total_scheduled_trips += 1;
      //.
      if (/RIDE/i.test(trip.ride_mode)) {
        //Ride
        modelMetaDataResponseTargeted[
          day_date_argument
        ].total_successful_scheduled_rides += 1;
      } else if (/DELIVERY/i.test(trip.ride_mode)) {
        //Delivery
        modelMetaDataResponseTargeted[
          day_date_argument
        ].total_successful_scheduled_deliveries += 1;
      }
    } //Immediate
    else {
      modelMetaDataResponseTargeted[
        day_date_argument
      ].total_immediate_trips += 1;
      //.
      if (/RIDE/i.test(trip.ride_mode)) {
        //Ride
        modelMetaDataResponseTargeted[
          day_date_argument
        ].total_successful_immediate_rides += 1;
      } else if (/DELIVERY/i.test(trip.ride_mode)) {
        //Delivery
        modelMetaDataResponseTargeted[
          day_date_argument
        ].total_successful_immediate_deliveries += 1;
      }
    }
    //...Payment method
    if (/cash/i.test(trip.payment_method)) {
      //Cash
      modelMetaDataResponseTargeted[day_date_argument].total_cash_trips +=
        parseFloat(trip.fare);
      //.
      if (/RIDE/i.test(trip.ride_mode)) {
        //Ride
        modelMetaDataResponseTargeted[
          day_date_argument
        ].total_successful_cash_rides += parseFloat(trip.fare);
      } else if (/DELIVERY/i.test(trip.ride_mode)) {
        //Delivery
        modelMetaDataResponseTargeted[
          day_date_argument
        ].total_successful_cash_deliveries += parseFloat(trip.fare);
      }
    } //Wallet
    else {
      modelMetaDataResponseTargeted[day_date_argument].total_wallet_trips +=
        parseFloat(trip.fare);
      //.
      if (/RIDE/i.test(trip.ride_mode)) {
        //Ride
        modelMetaDataResponseTargeted[
          day_date_argument
        ].total_successful_wallet_rides += parseFloat(trip.fare);
      } else if (/DELIVERY/i.test(trip.ride_mode)) {
        //Delivery
        modelMetaDataResponseTargeted[
          day_date_argument
        ].total_successful_wallet_deliveries += parseFloat(trip.fare);
      }
    }

    //? DONE
    return modelMetaDataResponseTargeted;
  } //Cancelled Trips
  else {
    modelMetaDataResponseTargeted[day_date_argument].date_refs.push(
      new Date(trip.date_requested)
    );
    modelMetaDataResponseTargeted[day_date_argument].total_trips += 1;
    modelMetaDataResponseTargeted[day_date_argument].total_cancelled_trips += 1;

    if (/RIDE/i.test(trip.ride_mode)) {
      //Ride
      modelMetaDataResponseTargeted[
        day_date_argument
      ].total_cancelled_rides += 1;
    } else if (/DELIVERY/i.test(trip.ride_mode)) {
      //Delivery
      modelMetaDataResponseTargeted[
        day_date_argument
      ].total_cancelled_deliveries += 1;
    }
    //...
    if (/connectme/i.test(trip.connect_type)) {
      //Connectme
      modelMetaDataResponseTargeted[
        day_date_argument
      ].total_connectme_trips += 1;
      if (/RIDE/i.test(trip.ride_mode)) {
        //Ride
        modelMetaDataResponseTargeted[
          day_date_argument
        ].total_cancelled_connectme_rides += 1;
      }
    } //ConnectUs
    else {
      modelMetaDataResponseTargeted[
        day_date_argument
      ].total_connectus_trips += 1;
      if (/RIDE/i.test(trip.ride_mode)) {
        //Ride
        modelMetaDataResponseTargeted[
          day_date_argument
        ].total_cancelled_connectus_rides += 1;
      }
    }
    //...Schedule
    if (/scheduled/i.test(trip.request_type)) {
      //Scheduled rides
      modelMetaDataResponseTargeted[
        day_date_argument
      ].total_scheduled_trips += 1;
      //.
      if (/RIDE/i.test(trip.ride_mode)) {
        //Ride
        modelMetaDataResponseTargeted[
          day_date_argument
        ].total_cancelled_scheduled_rides += 1;
      } else if (/DELIVERY/i.test(trip.ride_mode)) {
        //Delivery
        modelMetaDataResponseTargeted[
          day_date_argument
        ].total_cancelled_scheduled_deliveries += 1;
      }
    } //Immediate
    else {
      modelMetaDataResponseTargeted[
        day_date_argument
      ].total_immediate_trips += 1;
      //.
      if (/RIDE/i.test(trip.ride_mode)) {
        //Ride
        modelMetaDataResponseTargeted[
          day_date_argument
        ].total_cancelled_immediate_rides += 1;
      } else if (/DELIVERY/i.test(trip.ride_mode)) {
        //Delivery
        modelMetaDataResponseTargeted[
          day_date_argument
        ].total_cancelled_immediate_deliveries += 1;
      }
    }
    //...Payment method
    if (/cash/i.test(trip.payment_method)) {
      //Cash
      modelMetaDataResponseTargeted[day_date_argument].total_cash_trips +=
        parseFloat(trip.fare);
      //.
      if (/RIDE/i.test(trip.ride_mode)) {
        //Ride
        modelMetaDataResponseTargeted[
          day_date_argument
        ].total_cancelled_cash_rides += parseFloat(trip.fare);
      } else if (/DELIVERY/i.test(trip.ride_mode)) {
        //Delivery
        modelMetaDataResponseTargeted[
          day_date_argument
        ].total_cancelled_cash_deliveries += parseFloat(trip.fare);
      }
    } //Wallet
    else {
      modelMetaDataResponseTargeted[day_date_argument].total_wallet_trips +=
        parseFloat(trip.fare);
      //.
      if (/RIDE/i.test(trip.ride_mode)) {
        //Ride
        modelMetaDataResponseTargeted[
          day_date_argument
        ].total_cancelled_wallet_rides += parseFloat(trip.fare);
      } else if (/DELIVERY/i.test(trip.ride_mode)) {
        //Delivery
        modelMetaDataResponseTargeted[
          day_date_argument
        ].total_cancelled_wallet_deliveries += parseFloat(trip.fare);
      }
    }

    //? Done
    return modelMetaDataResponseTargeted;
  }
}

/**
 * Responsible for sorting objects by keys!
 */
function sortObj(obj) {
  return Object.keys(obj)
    .sort()
    .reduce(function (result, key) {
      result[key] = obj[key];
      return result;
    }, {});
}

/**
 * @func makegraphReady
 * Responsible for turning the standard views data to a react-vis graph ready format
 */
function makegraphReady(standardData) {
  //? 1. Sort the data
  standardData = sortObj(standardData);
  //..
  let tmpMetaChildObject = {};
  //...
  Object.keys(standardData).forEach((key) => {
    let tmpReadiness = standardData[key];
    let characteristic_label = key;
    let sorter = new Date(tmpReadiness.date_refs[0]).getTime();
    //...
    Object.keys(tmpReadiness).forEach((key2) => {
      tmpMetaChildObject[key2] =
        tmpMetaChildObject[key2] === undefined ||
        tmpMetaChildObject[key2] === null ||
        tmpMetaChildObject[key2].length === undefined ||
        tmpMetaChildObject[key2].length === null
          ? []
          : tmpMetaChildObject[key2];
      //...
      tmpMetaChildObject[key2].push({
        x: characteristic_label,
        y: tmpReadiness[key2],
        sorter: sorter,
      });
      //? Sort it
      tmpMetaChildObject[key2] = tmpMetaChildObject[key2].sort((a, b) =>
        a.sorter > b.sorter ? 1 : a.sorter < b.sorter ? -1 : 0
      );
    });
  });
  //Done
  return tmpMetaChildObject;
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
var collection_cancelledRidesDeliveryData = null;

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

      /**
       * GET GENERAL OBSERVABILITY DATA FOR DELIVERY WEB
       *? Responsible for getting all the data in motion that will reflect the current or historical
       *? state of the a specific delivery web profile.
       * REDIS propertiy
       */
      app.post("/getGlobalObservabilityDataDeliverWeb", function (req, res) {
        let request = req.body;
        if (request.user_fp !== undefined && request.user_fp !== null) {
          //! Reuse the req var
          req = request;
          //Check for graph readiness - default - false
          req.make_graphReady =
            req.make_graphReady !== undefined && req.make_graphReady !== null
              ? true
              : false;

          //Has the required data
          new Promise((resMAIN) => {
            getObservabilityDataForDeliveryWeb(request, resMAIN);
          })
            .then((result) => {
              //Isolate response based on the isolation_factor
              new Promise((resTokenize) => {
                //?Generate unique hash representing the current state of the data
                generateUniqueFingerprint(
                  `${JSON.stringify(result)}-${JSON.stringify(req)}`,
                  "sha256",
                  resTokenize
                );
              })
                .then((dataStateHash) => {
                  logger.warn(result);
                  result = result.data;
                  if (result !== undefined && result !== null) {
                    //? Use generic_view by default
                    req.isolation_factor =
                      req.isolation_factor !== undefined &&
                      req.isolation_factor !== null
                        ? req.isolation_factor
                        : "generic_view";
                    //?...
                    if (req.isolation_factor === "req.isolation_factor") {
                      res.send({
                        stateHash: dataStateHash,
                        response: result.genericGlobalStats,
                      });
                    } else if (req.isolation_factor === "generic_view") {
                      res.send({
                        stateHash: dataStateHash,
                        response: {
                          genericGlobalStats: result.genericGlobalStats,
                        },
                      });
                    } else if (
                      req.isolation_factor === "generic_view|weekly_view"
                    ) {
                      res.send({
                        stateHash: dataStateHash,
                        response: {
                          genericGlobalStats: result.genericGlobalStats,
                          weekly_view: req.make_graphReady
                            ? makegraphReady(result.weekly_view)
                            : result.weekly_view,
                        },
                      });
                    } else if (req.isolation_factor === "weekly_view") {
                      res.send({
                        stateHash: dataStateHash,
                        response: {
                          weekly_view: req.make_graphReady
                            ? makegraphReady(result.weekly_view)
                            : result.weekly_view,
                        },
                      });
                    } else if (
                      req.isolation_factor === "generic_view|daily_view"
                    ) {
                      res.send({
                        stateHash: dataStateHash,
                        response: {
                          genericGlobalStats: result.genericGlobalStats,
                          daily_view: req.make_graphReady
                            ? makegraphReady(result.daily_view)
                            : result.daily_view,
                        },
                      });
                    } else if (req.isolation_factor === "daily_view") {
                      res.send({
                        stateHash: dataStateHash,
                        response: {
                          daily_view: req.make_graphReady
                            ? makegraphReady(result.daily_view)
                            : result.daily_view,
                        },
                      });
                    } else if (
                      req.isolation_factor === "generic_view|monthly_view"
                    ) {
                      res.send({
                        stateHash: dataStateHash,
                        response: {
                          genericGlobalStats: result.genericGlobalStats,
                          monthly_view: req.make_graphReady
                            ? makegraphReady(result.monthly_view)
                            : result.monthly_view,
                        },
                      });
                    } else if (req.isolation_factor === "monthly_view") {
                      res.send({
                        stateHash: dataStateHash,
                        response: {
                          monthly_view: req.make_graphReady
                            ? makegraphReady(result.monthly_view)
                            : result.monthly_view,
                        },
                      });
                    } else if (
                      req.isolation_factor === "generic_view|yearly_view"
                    ) {
                      res.send({
                        stateHash: dataStateHash,
                        response: {
                          genericGlobalStats: result.genericGlobalStats,
                          yearly_view: req.make_graphReady
                            ? makegraphReady(result.yearly_view)
                            : result.yearly_view,
                        },
                      });
                    } else if (req.isolation_factor === "yearly_view") {
                      res.send({
                        stateHash: dataStateHash,
                        response: {
                          yearly_view: req.make_graphReady
                            ? makegraphReady(result.yearly_view)
                            : result.yearly_view,
                        },
                      });
                    } else if (req.isolation_factor === "all") {
                      //! Too heavy!
                      res.send({
                        stateHash: dataStateHash,
                        response: result,
                      });
                    } else {
                      //Generic view
                      res.send({
                        stateHash: dataStateHash,
                        response: result.genericGlobalStats,
                      });
                    }
                  } //No data
                  else {
                    res.send(result);
                  }
                })
                .catch((error) => {
                  logger.error(error);
                  res.send({ response: "error" });
                });
            })
            .catch((error) => {
              logger.error(error);
              res.send({ response: "error" });
            });
        } else {
          logger.warn("Could not find the required fp data");
          res.send({ response: "error" });
        }
      });
    }
  );
});
server.listen(process.env.ANALYTICS_SERVICE_PORT);
//dash.monitor({ server: server });
