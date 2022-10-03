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
const { raw } = require("express");

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

//? Static operations
const STATIC_OPERATIONS_MAP = {
  $in: "INCLUDES",
  $not: "EXCLUDES",
  $gte: "GREATER_THAN_EQUAL",
  $lte: "LESS_THAN_EQUAL",
};

async function createRemapped_filter(raw_mongoBased_filter) {
  let remapped_filter = [];
  filterReceived = raw_mongoBased_filter;

  Object.keys(filterReceived).forEach(function (key) {
    //...
    //! Fill in the op
    if (
      typeof filterReceived[key] === "string" ||
      typeof filterReceived[key] === "boolean" ||
      typeof filterReceived[key] === "bigint" ||
      typeof filterReceived[key] === "number"
    ) {
      //Normal String or bool, or number
      let tmpSubFilter = {
        op: null,
        key: key,
        value: null,
      };
      //...
      tmpSubFilter.op = "MATCH";
      tmpSubFilter.value = filterReceived[key];
      //? Save
      remapped_filter.push(tmpSubFilter);
    } else if (typeof filterReceived[key] === "object") {
      //Object
      Object.keys(filterReceived[key]).forEach(function (key2) {
        let tmpSubFilter = {
          op: null,
          key: key,
          value: null,
        };
        //...
        tmpSubFilter.op = STATIC_OPERATIONS_MAP[key2];
        tmpSubFilter.value = filterReceived[key][key2];
        //? Save
        remapped_filter.push(tmpSubFilter);
      });
    }
  });
  //...
  return remapped_filter;
}

/**
 * @func getDeepKeysValues
 * Responsible for getting the litteral object's deep values.
 * @param originalObject: the untouched object
 * @param keyString: the comma separated keys to get
 */
function getDeepKeysValues(originalObject, keyString) {
  let result = null;

  keyString.split(".").map((el) => {
    result =
      result !== null && result !== undefined ? result[el] : originalObject[el];
    return true;
  });
  return result;
}

/**
 * @func MAP_to_LOGIC
 * Responsible for converting the given map to more understandable logic resulting to a true of false value.
 * @param remapped_data: the remapped data
 * @param single_data: the data to be processed.
 */
async function MAP_to_LOGIC(remapped_data, single_data) {
  let arrayBools = [];

  remapped_data.map((remapped) => {
    switch (remapped.op) {
      case "MATCH":
        arrayBools.push(
          getDeepKeysValues(single_data, remapped.key) === remapped.value
        );
        break;

      case "INCLUDES":
        arrayBools.push(
          remapped.value.includes(getDeepKeysValues(single_data, remapped.key))
        );
        break;

      case "LESS_THAN_EQUAL":
        if (typeof remapped.value) {
          //If object - take as date
          arrayBools.push(
            new Date(getDeepKeysValues(single_data, remapped.key)) <=
              remapped.value
          );
        } //Take as number
        else {
          arrayBools.push(
            getDeepKeysValues(single_data, remapped.key) <= remapped.value
          );
        }
        break;

      case "GREATER_THAN_EQUAL":
        if (typeof remapped.value) {
          //If object - take as date
          arrayBools.push(
            new Date(getDeepKeysValues(single_data, remapped.key)) >=
              remapped.value
          );
        } //Take as number
        else {
          arrayBools.push(
            getDeepKeysValues(single_data, remapped.key) >= remapped.value
          );
        }
        break;

      default:
        break;
    }
  });

  //! Done
  return arrayBools;
}

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

module.exports = {
  /**
   * @func provideDataForCollection
   * Responsible for providing collectiond data dynamically based on the cache or straight from mongodb if need be
   * @param collectionData: the instance of the instance
   * @param collectionData_name: the name of the instance to be used as redisKey
   * @param filter: the filter to get targeted data
   */
  provideDataForCollection: function (
    collectionData,
    collectionData_name,
    filter = {}
  ) {
    //! Check if a cached value is set
    return redisGet(collectionData_name).then((resp) => {
      if (resp !== null) {
        //Has cached value
        try {
          logger.info("GOT CACHED GLOBAL DATA");
          resp = JSON.parse(resp);

          //! Apply any potential filters
          if (Object.keys(filter).length > 0) {
            let filteredData = [];
            //A filter is defined
            //? 1. Create a remapped version of the filter
            let remapped_filter = createRemapped_filter(filter);
            logger.info(remapped_filter);

            return remapped_filter
              .then((rm_filter) => {
                let parentPromises = resp.map((dataToProcess) => {
                  return new Promise((resCompute) => {
                    MAP_to_LOGIC(rm_filter, dataToProcess)
                      .then((resultChoice) => {
                        if (resultChoice.includes(true)) {
                          //   logger.warn(resultChoice);
                        }

                        if (resultChoice.includes(false) === false) {
                          //!Passed the test
                          resCompute(dataToProcess);
                        } else {
                          resCompute(null);
                        }
                      })
                      .catch((error) => {
                        logger.error(error);
                        resCompute(null);
                      });
                  });
                });
                //...
                return Promise.all(parentPromises)
                  .then((result) => {
                    result = result.filter(
                      (val) => val !== null && val !== undefined
                    );
                    // logger.error(result);
                    return result;
                  })
                  .catch((error) => {
                    logger.error(error);
                    return [];
                  });
              })
              .catch((error) => {
                logger.error(error);
                return [];
              });
          } //No filters defined
          else {
            return resp;
          }
        } catch (error) {
          logger.error(error);
          collectionData
            .find(filter)
            .toArray(function (err, dataTobeCollected) {
              if (err) {
                logger.error(err);
              }
              //! Cache globally
              new Promise((resolve) => {
                cacheTheDataOrderly(
                  collectionData,
                  collectionData_name,
                  false,
                  null,
                  resolve
                );
              })
                .then((result) => logger.info(result))
                .catch((error) => logger.error(error));
              //...
              return dataTobeCollected;
            });
        }
      } //No cached value - get from mongodb - expensive
      else {
        collectionData.find(filter).toArray(function (err, dataTobeCollected) {
          if (err) {
            logger.error(err);
          }
          //! Cache globally
          new Promise((resolve) => {
            cacheTheDataOrderly(
              collectionData,
              collectionData_name,
              false,
              null,
              resolve
            );
          })
            .then((result) => logger.info(result))
            .catch((error) => logger.error(error));
          //...
          return dataTobeCollected;
        });
      }
    });
  },
  /**
   * @func filterDataBasedOnNeed
   * Responsible for filtering the datat dynamically based on the mongodb needs
   * @param rawData: the original data to be filtered
   * @param filter: the filter to get targeted data
   */
  filterDataBasedOnNeed: async function (rawData, filter) {
    let resp = rawData;
    //! Apply any potential filters
    if (Object.keys(filter).length > 0) {
      let filteredData = [];
      //A filter is defined
      //? 1. Create a remapped version of the filter
      let remapped_filter = createRemapped_filter(filter);
      logger.info(remapped_filter);

      return remapped_filter
        .then((rm_filter) => {
          let parentPromises = resp.map((dataToProcess) => {
            return new Promise((resCompute) => {
              MAP_to_LOGIC(rm_filter, dataToProcess)
                .then((resultChoice) => {
                  if (resultChoice.includes(true)) {
                    //   logger.warn(resultChoice);
                  }

                  if (resultChoice.includes(false) === false) {
                    //!Passed the test
                    resCompute(dataToProcess);
                  } else {
                    resCompute(null);
                  }
                })
                .catch((error) => {
                  logger.error(error);
                  resCompute(null);
                });
            });
          });
          //...
          return Promise.all(parentPromises)
            .then((result) => {
              result = result.filter(
                (val) => val !== null && val !== undefined
              );
              logger.error(result);
              return result;
            })
            .catch((error) => {
              logger.error(error);
              return [];
            });
        })
        .catch((error) => {
          logger.error(error);
          return [];
        });
    } //No filters defined
    else {
      return resp;
    }
  },
};
