require("dotenv").config();
require("newrelic");
//var dash = require("appmetrics-dash");
var express = require("express");
const http = require("http");
const MongoClient = require("mongodb").MongoClient;

const { logger } = require("./LogService");

var app = express();
var server = http.createServer(app);
const requestAPI = require("request");
const { parse, stringify } = require("flatted");
//....
const { promisify } = require("util");
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

const clientMongo = new MongoClient(process.env.URL_MONGODB, {
  useUnifiedTopology: true,
  useNewUrlParser: true,
});

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
 * Schema of the Input meta data of the pricing main operation processor
 * The type of data expected as input when trying the estimate the prices
 * ...Place here
 */

/**
 * @func checkInputIntegrity
 * @param input: data input to the pricing estimator engine
 * Responsible for checking that the input data to the pricing engine has the required set of parameters and
 * that they follow all the required patterns.
 * Returns true if correct (can be proccessed) or false (failed the integrity check)
 */
function checkInputIntegrity(input) {
  if (input.connect_type !== undefined && input.connect_type !== null) {
    //clean
    if (
      input.user_fingerprint !== undefined &&
      input.user_fingerprint !== null &&
      input.request_type !== undefined &&
      input.request_type !== null &&
      input.pickup_time !== undefined &&
      input.pickup_time !== null &&
      input.country !== undefined &&
      input.country !== null &&
      input.pickup_location_infos !== undefined &&
      input.pickup_location_infos !== null &&
      input.destination_location_infos !== undefined &&
      input.destination_location_infos !== null &&
      input.passengers_number !== undefined &&
      input.passengers_number !== null
    ) {
      //check
      //Check the pickup location infos
      let pickupInfos = input.pickup_location_infos;
      if (
        pickupInfos.pickup_type !== undefined &&
        pickupInfos.pickup_type !== null &&
        pickupInfos.coordinates !== undefined &&
        pickupInfos.coordinates !== null &&
        pickupInfos.location_name !== undefined &&
        pickupInfos.location_name !== null
      ) {
        //Check
        //Check the destination infos
        let destinationInfos = input.destination_location_infos;
        if (
          destinationInfos[0].passenger_number_id !== undefined &&
          destinationInfos[0].passenger_number_id !== null
        ) {
          //check
          //Check passenger 1 doubt beneficiairy data: rely on passenger 1 to determine the integrity of the rest of the passenger's data
          let passenger1Infos = input.destination_location_infos[0];
          if (
            passenger1Infos.dropoff_type !== undefined &&
            passenger1Infos.dropoff_type !== null &&
            passenger1Infos.coordinates !== undefined &&
            passenger1Infos.coordinates !== null &&
            passenger1Infos.location_name !== undefined &&
            passenger1Infos.location_name !== null &&
            passenger1Infos.street_name !== undefined &&
            passenger1Infos.street_name !== null &&
            passenger1Infos.suburb !== undefined &&
            passenger1Infos.suburb !== null &&
            passenger1Infos.city !== undefined &&
            passenger1Infos.city !== null
          ) {
            //check
            //Integrity validated
            return true;
          } //Invalid
          else {
            return false;
          }
        } //Invalid
        else {
          return false;
        }
      } //Invalid
      else {
        return false;
      }
    } //Invalid
    else {
      return false;
    }
  } //Invalid
  else {
    return false;
  }
}

/**
 * @func autocompleteInputData
 * @param inputData: data that passed successfully the integrity test
 * @param collectionSavedSuburbResults: collection of already completed similar places to refer to if needed
 * @param resolve: from the promise
 * Responsible for filling up additional data required for a very accurate price estimation.
 * Specifically the suburbs infos and the drop off types of the destinations.
 * Save record in Mongo and Cache when down.
 * REDIS SCHEMA
 * key: savedSuburbResults-location_name-street_name-city
 * data: [{}, {}, ...]
 */
function autocompleteInputData(
  resolve,
  inputData,
  collectionSavedSuburbResults
) {
  let pickupInfos = inputData.pickup_location_infos;
  let destinationInfos = inputData.destination_location_infos;
  //[PICKUP LOCATION] Complete pickup location suburb infos
  //Check Redis for previous record
  let redisKey =
    "savedSuburbResults-" +
    (pickupInfos.location_name !== undefined &&
    pickupInfos.location_name !== false
      ? pickupInfos.location_name.trim().toLowerCase()
      : pickupInfos.location_name) +
    "-" +
    (pickupInfos.street_name !== undefined && pickupInfos.street_name !== false
      ? pickupInfos.street_name.trim().toLowerCase()
      : pickupInfos.street_name) +
    "-" +
    (pickupInfos.city !== undefined && pickupInfos.city !== false
      ? pickupInfos.city.trim().toLowerCase()
      : pickupInfos.city);
  //..
  //! Form Redis Key for final result
  let redisFinal = `${redisKey}-${JSON.stringify(
    destinationInfos.map((data) => data.location_name)
  )}-finalResult`;
  //...
  redisGet(redisFinal)
    .then((resp) => {
      if (resp !== null) {
        try {
          resp = parse(resp);
          //TODO:  Restore essential data, BUT do not overwrite unique trip data
          inputData.pickup_location_infos.suburb =
            resp.pickup_location_infos.suburb; //Update main object
          inputData.pickup_location_infos.state =
            resp.pickup_location_infos.state;
          inputData.destination_location_infos =
            resp.destination_location_infos;
          //?--
          //! Do a quick pre-integrity check
          if (
            inputData.pickup_location_infos.suburb !== undefined &&
            inputData.pickup_location_infos.suburb !== false &&
            inputData.destination_location_infos[0].dropoff_type !==
              undefined &&
            inputData.destination_location_infos[0].dropoff_type !== false &&
            inputData.destination_location_infos[0].suburb !== undefined &&
            inputData.destination_location_infos[0].suburb !== false &&
            inputData.destination_location_infos[0].state !== undefined &&
            inputData.destination_location_infos[0].state !== false
          ) {
            resolve(inputData);
          } //Make a fresh test
          else {
            new Promise((resCompute) => {
              execTrueAutocompleteInputData(
                redisKey,
                redisFinal,
                inputData,
                collectionSavedSuburbResults,
                resCompute
              );
            })
              .then((result) => {
                resolve(result);
              })
              .catch((error) => {
                logger.info(error);
                resolve(false);
              });
          }
        } catch (error) {
          logger.warn(error);
          //Make a fresh request
          new Promise((resCompute) => {
            execTrueAutocompleteInputData(
              redisKey,
              redisFinal,
              inputData,
              collectionSavedSuburbResults,
              resCompute
            );
          })
            .then((result) => {
              resolve(result);
            })
            .catch((error) => {
              logger.info(error);
              resolve(false);
            });
        }
      } //No cached data - make a fresh request
      else {
        new Promise((resCompute) => {
          execTrueAutocompleteInputData(
            redisKey,
            redisFinal,
            inputData,
            collectionSavedSuburbResults,
            resCompute
          );
        })
          .then((result) => {
            resolve(result);
          })
          .catch((error) => {
            logger.info(error);
            resolve(false);
          });
      }
    })
    .catch((error) => {
      logger.info(error);
      //Make a fresh request
      new Promise((resCompute) => {
        execTrueAutocompleteInputData(
          redisKey,
          redisFinal,
          inputData,
          collectionSavedSuburbResults,
          resCompute
        );
      })
        .then((result) => {
          resolve(result);
        })
        .catch((error) => {
          logger.info(error);
          resolve(false);
        });
    });
}

/**
 * @func execTrueAutocompleteInputData
 * Responsible for truly executing the autocomplete for the input data in every stage.
 * @param redisKey: the redis key for the cached data.
 * @param redisFinal: the redis key to store the final result.
 * @param inputData: data that passed successfully the integrity test
 * @param collectionSavedSuburbResults: collection of already completed similar places to refer to if needed
 * @param resolve: from the promise
 */
function execTrueAutocompleteInputData(
  redisKey,
  redisFinal,
  inputData,
  collectionSavedSuburbResults,
  resolve
) {
  let pickupInfos = inputData.pickup_location_infos;
  let destinationInfos = inputData.destination_location_infos;
  redisGet(redisKey)
    .then(
      (resp) => {
        if (resp !== null && resp !== undefined) {
          //Found a record
          resp = JSON.parse(resp);
          logger.info("Found something in the cache");
          //Check if there's our concerned record for the pickup location
          let focusedRecord = resp;
          //Check for wanted record
          if (focusedRecord !== false && focusedRecord.suburb !== undefined) {
            //Found something
            logger.info("Found a wanted cached record.");
            //TODO: Keep as essential data  when getting cached data
            inputData.pickup_location_infos.suburb = focusedRecord.suburb; //Update main object
            inputData.pickup_location_infos.state = focusedRecord.state;
            //? ---------
            pickupInfos = inputData.pickup_location_infos.state; //Update shortcut var
            //...Done auto complete destination locations
            new Promise((res) => {
              manageAutoCompleteDestinationLocations(
                res,
                destinationInfos,
                inputData.user_fingerprint,
                collectionSavedSuburbResults
              );
            }).then(
              (result) => {
                logger.info("HERRRREE -- > ", result);
                if (result !== false) {
                  //TODO: Keep as essential data  when getting cached data
                  inputData.destination_location_infos = result; //Update main object
                  //? -------------
                  destinationInfos = result; //Update shortcut object
                  //! Cache the final response
                  new Promise((resCache) => {
                    redisCluster.set(redisFinal, stringify(inputData));
                    resCache(true);
                  })
                    .then()
                    .catch();
                  //! ------------------------
                  //DONE AUTOCOMPLETING
                  resolve(inputData);
                } //Error
                else {
                  resolve(false);
                }
              },
              (error) => {
                logger.info(error);
                resolve(false);
              }
            );
          } //No wanted record - do a fresh search
          else {
            new Promise((res) => {
              doMongoSearchForAutocompletedSuburbs(
                res,
                pickupInfos,
                collectionSavedSuburbResults
              );
            }).then(
              (result) => {
                if (result !== false) {
                  inputData.pickup_location_infos.suburb = result.suburb; //Update main object
                  inputData.pickup_location_infos.state = result.state;
                  pickupInfos = inputData.pickup_location_infos; //Update shortcut var
                  //...Done auto complete destination locations
                  //logger.info(result);
                  new Promise((res) => {
                    manageAutoCompleteDestinationLocations(
                      res,
                      destinationInfos,
                      inputData.user_fingerprint,
                      collectionSavedSuburbResults
                    );
                  }).then(
                    (result) => {
                      if (result !== false) {
                        inputData.destination_location_infos = result; //Update main object
                        destinationInfos = result; //Update shortcut object
                        //! Cache the final response
                        new Promise((resCache) => {
                          redisCluster.set(redisFinal, stringify(inputData));
                          resCache(true);
                        })
                          .then()
                          .catch();
                        //! ------------------------
                        //DONE AUTOCOMPLETING
                        resolve(inputData);
                      } //Error
                      else {
                        resolve(false);
                      }
                    },
                    (error) => {
                      logger.info(error);
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
        } //No records - do a fresh search
        else {
          //No cached result, do a mongo search
          logger.info("[No cache] No cached data, do mongo search");
          new Promise((res) => {
            doMongoSearchForAutocompletedSuburbs(
              res,
              pickupInfos,
              collectionSavedSuburbResults
            );
          }).then(
            (result) => {
              if (result !== false) {
                inputData.pickup_location_infos.suburb = result.suburb; //Update main object
                inputData.pickup_location_infos.state = result.state;
                pickupInfos = inputData.pickup_location_infos; //Update shortcut var
                //...Done auto complete destination locations
                new Promise((res) => {
                  manageAutoCompleteDestinationLocations(
                    res,
                    destinationInfos,
                    inputData.user_fingerprint,
                    collectionSavedSuburbResults
                  );
                }).then(
                  (result) => {
                    logger.info("HERRRREE -- > ", result);
                    if (result !== false) {
                      inputData.destination_location_infos = result; //Update main object
                      destinationInfos = result; //Update shortcut object
                      //! Cache the final response
                      new Promise((resCache) => {
                        redisCluster.set(redisFinal, stringify(inputData));
                        resCache(true);
                      })
                        .then()
                        .catch();
                      //! ------------------------
                      //DONE AUTOCOMPLETING
                      resolve(inputData);
                    } //Error
                    else {
                      resolve(false);
                    }
                  },
                  (error) => {
                    logger.info(error);
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
      },
      (error) => {
        //No cached result, do a mongo search
        logger.info("Error, No cached data, do mongo search");
        new Promise((res) => {
          doMongoSearchForAutocompletedSuburbs(
            res,
            pickupInfos,
            collectionSavedSuburbResults
          );
        }).then(
          (result) => {
            if (result !== false) {
              inputData.pickup_location_infos.suburb = result.suburb; //Update main object
              inputData.pickup_location_infos.state = result.state;
              pickupInfos = inputData.pickup_location_infos; //Update shortcut var
              //...Done auto complete destination locations
              new Promise((res) => {
                manageAutoCompleteDestinationLocations(
                  res,
                  destinationInfos,
                  inputData.user_fingerprint,
                  collectionSavedSuburbResults
                );
              }).then(
                (result) => {
                  if (result !== false) {
                    inputData.destination_location_infos = result; //Update main object
                    destinationInfos = result; //Update shortcut object
                    //! Cache the final response
                    new Promise((resCache) => {
                      redisCluster.set(redisFinal, stringify(inputData));
                      resCache(true);
                    })
                      .then()
                      .catch();
                    //! ------------------------
                    //DONE AUTOCOMPLETING
                    resolve(inputData);
                  } //Error
                  else {
                    resolve(false);
                  }
                },
                (error) => {
                  logger.info(error);
                  resolve(false);
                }
              );
            }
          },
          (error) => {
            logger.info(error);
            resolve(false);
          }
        );
      }
    )
    .catch((error) => {
      logger.info(error);
      resolve(false);
    });
}

/**
 * @func manageAutoCompleteDestinationLocations
 * @param resolve
 * @param destinationLocations: destination location array
 * @param collectionSavedSuburbResults: collection of already processed locations
 * @param user_fingerprint: fingerprint of the user responsible for the request
 * Depend on @func doMongoSearchForAutocompletedSuburbs
 * Responsible for autocompleting input data for ALL the destination locations and return the complete array.
 * REDIS
 * key: destinationLocationsAutoCompletedNature-location_name-location_street-city: [{location_name, street_name, suburb, city, locationType}]
 */
function manageAutoCompleteDestinationLocations(
  resolve,
  destinationLocations,
  user_fingerprint,
  collectionSavedSuburbResults
) {
  logger.info("AUTO COMPLETE DESTINATION DATA");
  let promiseParent = destinationLocations.map((destination) => {
    return new Promise((res) => {
      //! Swap latitude and longitude (cause they were reversed)- MAJOR FIX! --IS IT???
      //! APPLY BLUE OCEAN BUG FIX FOR THE PICKUP LOCATION COORDINATES
      //? Get temporary vars
      let pickLatitude = parseFloat(destination.coordinates.latitude);
      let pickLongitude = parseFloat(destination.coordinates.longitude);
      //! Coordinates order fix - major bug fix for ocean bug
      if (
        pickLatitude !== undefined &&
        pickLatitude !== null &&
        pickLatitude !== 0 &&
        pickLongitude !== undefined &&
        pickLongitude !== null &&
        pickLongitude !== 0
      ) {
        //? Switch latitude and longitude - check the negative sign
        if (parseFloat(pickLongitude) < 0) {
          //Negative - switch
          destination.coordinates.latitude = pickLongitude;
          destination.coordinates.longitude = pickLatitude;
        }
      }
      //!!!
      doMongoSearchForAutocompletedSuburbs(
        res,
        destination,
        collectionSavedSuburbResults,
        true
      );
    });
  });
  Promise.all(promiseParent).then(
    (result) => {
      logger.info(result);
      if (result !== false) {
        //Update the input data
        destinationLocations.map((prevLocation, index) => {
          result.map((completeLocation) => {
            if (
              /*completeLocation.location_name === prevLocation.location_name &&
              completeLocation.street_name === prevLocation.street_name &&
              completeLocation.city === prevLocation.city*/
              parseInt(completeLocation.passenger_number_id) ===
              parseInt(prevLocation.passenger_number_id)
            ) {
              //Same location - update - else ignore
              destinationLocations[index].suburb =
                completeLocation.suburb !== false &&
                completeLocation.suburb !== undefined
                  ? completeLocation.suburb
                  : prevLocation.location_name;
              destinationLocations[index].state =
                completeLocation.state !== false &&
                completeLocation.state !== undefined
                  ? completeLocation.state
                  : prevLocation.city;
            }
          });
        });
        //Autocomplete the location types : taxi rank, airports or private locations
        let promiseParent2 = destinationLocations.map((destination) => {
          return new Promise((res) => {
            let url =
              process.env.LOCAL_URL +
              ":" +
              process.env.MAP_SERVICE_PORT +
              "/identifyPickupLocation?latitude=" +
              destination.coordinates.latitude +
              "&longitude=" +
              destination.coordinates.longitude +
              "&user_fingerprint=" +
              user_fingerprint;
            requestAPI(url, function (error, response, body) {
              logger.info(body);
              if (error === null) {
                try {
                  body = JSON.parse(body);
                  body.passenger_number_id = destination.passenger_number_id;
                  res(body);
                } catch (error) {
                  //Defaults to privateLocation
                  body = {};
                  body.locationType = "PrivateLocation";
                  body.passenger_number_id = destination.passenger_number_id;
                  res(body);
                }
              } else {
                //Defaults to privateLocation
                body = {};
                body.locationType = "PrivateLocation";
                body.passenger_number_id = destination.passenger_number_id;
                res(body);
              }
            });
          });
        });
        //..
        Promise.all(promiseParent2).then(
          (result) => {
            result.map((location) => {
              if (
                location !== undefined &&
                location.passenger_number_id !== undefined
              ) {
                //Linked to a user
                destinationLocations[
                  location.passenger_number_id - 1
                ].dropoff_type = location.locationType;
                //Cache the location
                new Promise((res) => {
                  let redisKey =
                    "destinationLocationsAutoCompletedNature-" +
                    (destinationLocations.location_name !== undefined &&
                    destinationLocations.location_name !== false
                      ? destinationLocations.location_name.trim().toLowerCase()
                      : destinationLocations.location_name) +
                    "-" +
                    (destinationLocations.street_name !== undefined &&
                    destinationLocations.street_name !== false
                      ? destinationLocations.street_name.trim().toLowerCase()
                      : destinationLocations.street_name) +
                    "-" +
                    (destinationLocations.city !== undefined &&
                    destinationLocations.city !== false
                      ? destinationLocations.city.trim().toLowerCase()
                      : destinationLocations.city);
                  //Check if redis already have key record
                  redisCluster.set(
                    redisKey,
                    JSON.stringify({
                      location_name: destinationLocations.location_name,
                      street_name: destinationLocations.street_name,
                      suburb: destinationLocations.suburb,
                      city: destinationLocations.city,
                      locationType: location.locationType,
                    })
                  );
                  res(true);
                }).then(
                  () => {},
                  () => {}
                );
              }
            });
            //DONE
            resolve(destinationLocations);
          },
          (error) => {
            //Default all the location types to Private location
            logger.info(error);
            destinationLocations.map((location, index) => {
              destinationLocations[index].dropoff_type = "PrivateLocation";
            });
            resolve(destinationLocations);
          }
        );
      } else {
        destinationLocations.map((location, index) => {
          destinationLocations[index].dropoff_type = "PrivateLocation";
        });
        resolve(destinationLocations);
      }
    },
    (error) => {
      logger.info(error);
      destinationLocations.map((location, index) => {
        destinationLocations[index].dropoff_type = "PrivateLocation";
      });
      resolve(destinationLocations);
    }
  );
}

/**
 * @func doMongoSearchForAutocompletedSuburbs
 * @param locationInfos: object containing specific single location infos
 * @param resolve
 * @param collectionSavedSuburbResults: collection containing all the already proccessed records
 * @param annotate: whether or not the put index annotations
 * Responsible for checking in mongodb for previous exact record already searched.
 */
function doMongoSearchForAutocompletedSuburbs(
  resolve,
  locationInfos,
  collectionSavedSuburbResults,
  annotate = false
) {
  //! Make sure that "make_new" is provided
  if (locationInfos.make_new === undefined || locationInfos.make_new === null) {
    locationInfos["make_new"] = false;
  }
  //!!!
  let redisKey = `savedSuburbResults-
    ${
      locationInfos.location_name !== undefined &&
      locationInfos.location_name !== false
        ? locationInfos.location_name.trim().toLowerCase()
        : locationInfos.location_name
    }-
    ${
      locationInfos.street_name !== undefined &&
      locationInfos.street_name !== false
        ? locationInfos.street_name.trim().toLowerCase()
        : locationInfos.street_name
    }-
    ${
      locationInfos.city !== undefined && locationInfos.city !== false
        ? locationInfos.city.trim().toLowerCase()
        : locationInfos.city
    }-
    ${
      locationInfos.country !== undefined && locationInfos.country !== false
        ? locationInfos.country.trim().toLowerCase()
        : locationInfos.country
    }`;
  //Check from redis first
  redisGet(redisKey).then(
    (resp) => {
      if (resp !== null && locationInfos.make_new === false) {
        //Has a previous record
        try {
          //Rehydrate the cached data
          /*new Promise((res) => {
            execMongoSearchAutoComplete(
              res,
              locationInfos,
              redisKey,
              collectionSavedSuburbResults,
              annotate
            );
          }).then(
            (result) => {},
            (error) => {}
          );*/
          logger.info("FOUND REDIS RECORD OF SUBURB!");
          resp = JSON.parse(resp);
          if (
            resp.location_name !== undefined &&
            resp.location_name !== null &&
            resp.suburb !== undefined &&
            resp.suburb !== null
          ) {
            resp["passenger_number_id"] =
              locationInfos.passenger_number_id !== undefined &&
              locationInfos.passenger_number_id !== null
                ? locationInfos.passenger_number_id
                : 1;
            resolve(resp);
          } //Do fresh search
          else {
            new Promise((res) => {
              execMongoSearchAutoComplete(
                res,
                locationInfos,
                redisKey,
                collectionSavedSuburbResults,
                annotate
              );
            }).then(
              (result) => {
                resolve(result);
              },
              (error) => {
                resolve(false);
              }
            );
          }
        } catch (
          error //Error parsing -get from mongodb
        ) {
          new Promise((res) => {
            execMongoSearchAutoComplete(
              res,
              locationInfos,
              redisKey,
              collectionSavedSuburbResults,
              annotate
            );
          }).then(
            (result) => {
              resolve(result);
            },
            (error) => {
              resolve(false);
            }
          );
        }
      } //No records - get from mongodb
      else {
        new Promise((res) => {
          execMongoSearchAutoComplete(
            res,
            locationInfos,
            redisKey,
            collectionSavedSuburbResults,
            annotate
          );
        }).then(
          (result) => {
            resolve(result);
          },
          (error) => {
            logger.info(error);
            resolve(false);
          }
        );
      }
    },
    (error) => {
      logger.info(error);
      //Error -get from mongodb
      new Promise((res) => {
        execMongoSearchAutoComplete(
          res,
          locationInfos,
          redisKey,
          collectionSavedSuburbResults,
          annotate
        );
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

/**
 * @func execMongoSearchAutoComplete
 * Responsible for actively performing the location search from nominatim or mongodb.
 * @param locationInfos: object containing specific single location infos
 * @param resolve
 * @param collectionSavedSuburbResults: collection containing all the already proccessed records
 * @param annotate: whether or not to add index number to the results
 * @param redisKey: corresponding record key for this location point
 */
function execMongoSearchAutoComplete(
  resolve,
  locationInfos,
  redisKey,
  collectionSavedSuburbResults,
  annotate = false
) {
  //! Make sure that "make_new" is provided
  if (locationInfos.make_new === undefined || locationInfos.make_new === null) {
    locationInfos["make_new"] = false;
  }
  //!!!
  resolveDate();
  //Check mongodb for previous record
  let findPrevQuery = {
    location_name: locationInfos.location_name,
    city: locationInfos.city,
    street_name: locationInfos.street_name,
  };
  collectionSavedSuburbResults
    .find(findPrevQuery)
    .toArray(function (err, result) {
      if (
        result !== undefined &&
        result.length > 0 &&
        locationInfos.make_new === false
      ) {
        //Found previous record
        //! Make a fresh search
        let url =
          process.env.URL_NOMINATIM_SERVICES +
          "/reverse?format=json&lat=" +
          locationInfos.coordinates.latitude +
          "&lon=" +
          locationInfos.coordinates.longitude +
          "&zoom=18&addressdetails=1&extratags=1&namedetails=1";
        requestAPI(url, function (err, response, body) {
          try {
            //Get only the state and suburb infos
            body = JSON.parse(body);
            if (body.address !== undefined && body.address !== null) {
              if (
                body.address.state !== undefined &&
                body.address.suburb !== undefined
              ) {
                //? Update the previous record
                logger.info("fresh search done!");
                new Promise((res1) => {
                  //Save result in MongoDB
                  let newRecord = {
                    $set: {
                      suburb: body.address.suburb,
                      state: body.address.state,
                      location_name:
                        body.namedetails["name"] !== undefined &&
                        body.namedetails["name"] !== null
                          ? body.namedetails["name"]
                          : body.address.amenity !== undefined &&
                            body.address.amenity !== null
                          ? body.address.amenity
                          : body.address.road,
                      city: body.address.city,
                      country: body.address.country,
                      street_name:
                        body.address.road !== undefined &&
                        body.address.road !== null
                          ? body.address.road
                          : body.namedetails["name:en"],
                      date_updated: new Date(chaineDateUTC),
                    },
                  };

                  collectionSavedSuburbResults.updateOne(
                    findPrevQuery,
                    newRecord,
                    function (err, reslt) {
                      logger.info("Updated prev record in mongo");
                      res1(true);
                    }
                  );
                }).then(
                  () => {},
                  () => {}
                );

                //Cache result
                new Promise((res2) => {
                  //Update the cache
                  //add new record
                  redisCluster.setex(
                    redisKey,
                    parseInt(process.env.REDIS_EXPIRATION_5MIN) * 9,
                    JSON.stringify({
                      suburb: body.address.suburb,
                      state: body.address.state,
                      location_name:
                        body.namedetails["name"] !== undefined &&
                        body.namedetails["name"] !== null
                          ? body.namedetails["name"]
                          : body.address.amenity !== undefined &&
                            body.address.amenity !== null
                          ? body.address.amenity
                          : body.address.road,
                      city: body.address.city,
                      country: body.address.country,
                      street_name:
                        body.address.road !== undefined &&
                        body.address.road !== null
                          ? body.address.road
                          : body.namedetails["name:en"],
                    })
                  );
                  //...
                  res2(true);
                }).then(
                  () => {},
                  (error) => {
                    logger.info(error);
                  }
                );
                //..respond - complete the input data
                //locationInfos.suburb = body.address.suburb;
                //locationInfos.state = body.address.state;
                resolve({
                  passenger_number_id:
                    locationInfos.passenger_number_id !== undefined &&
                    locationInfos.passenger_number_id !== null
                      ? locationInfos.passenger_number_id
                      : 1,
                  suburb: body.address.suburb,
                  state: body.address.state,
                  location_name:
                    body.namedetails["name"] !== undefined &&
                    body.namedetails["name"] !== null
                      ? body.namedetails["name"]
                      : body.address.amenity !== undefined &&
                        body.address.amenity !== null
                      ? body.address.amenity
                      : body.address.road,
                  city: body.address.city,
                  country: body.address.country,
                  street_name:
                    body.address.road !== undefined &&
                    body.address.road !== null
                      ? body.address.road
                      : body.namedetails["name"],
                });
              } //Error
              else {
                resolve(false);
              }
            } //error
            else {
              resolve(false);
            }
          } catch (error) {
            logger.info(error);
            resolve(false);
          }
        });
      } //Do a fresh search
      else {
        logger.info(
          "PERFORM FRESH GEOCODINGR -->",
          locationInfos.coordinates.latitude,
          ",",
          locationInfos.coordinates.longitude
        );
        let url =
          process.env.URL_NOMINATIM_SERVICES +
          "/reverse?format=json&lat=" +
          locationInfos.coordinates.latitude +
          "&lon=" +
          locationInfos.coordinates.longitude +
          "&zoom=18&addressdetails=1&extratags=1&namedetails=1";
        requestAPI(url, function (err, response, body) {
          try {
            logger.info(body);
            //Get only the state and suburb infos
            body = JSON.parse(body);
            if (body.address !== undefined && body.address !== null) {
              if (
                body.address.state !== undefined &&
                body.address.suburb !== undefined
              ) {
                //! PICKUP LOCATION REINFORCEMENTS
                logger.info("fresh search done! - MAKE NEW");
                try {
                  new Promise((res1) => {
                    //Save result in MongoDB
                    let newRecord = {
                      suburb: body.address.suburb,
                      state: body.address.state,
                      location_name:
                        body.namedetails["name"] !== undefined &&
                        body.namedetails["name"] !== null
                          ? body.namedetails["name"]
                          : body.address.amenity !== undefined &&
                            body.address.amenity !== null
                          ? body.address.amenity
                          : body.address.road,
                      city: body.address.city,
                      country: body.address.country,
                      street_name:
                        body.address.road !== undefined &&
                        body.address.road !== null
                          ? body.address.road
                          : body.namedetails["name:en"],
                      date_updated: new Date(chaineDateUTC),
                    };

                    collectionSavedSuburbResults.insertOne(
                      newRecord,
                      function (err, reslt) {
                        logger.info("Saved new record in mongo");
                        res1(true);
                      }
                    );
                  }).then(
                    () => {},
                    () => {}
                  );

                  //Cache result
                  new Promise((res2) => {
                    //Update the cache
                    //add new record
                    redisCluster.setex(
                      redisKey,
                      parseInt(process.env.REDIS_EXPIRATION_5MIN) * 9,
                      JSON.stringify({
                        suburb: body.address.suburb,
                        state: body.address.state,
                        location_name:
                          body.namedetails["name"] !== undefined &&
                          body.namedetails["name"] !== null
                            ? body.namedetails["name"]
                            : body.address.amenity !== undefined &&
                              body.address.amenity !== null
                            ? body.address.amenity
                            : body.address.road,
                        city: body.address.city,
                        country: body.address.country,
                        street_name:
                          body.address.road !== undefined &&
                          body.address.road !== null
                            ? body.address.road
                            : body.namedetails["name:en"],
                      })
                    );
                    //...
                    res2(true);
                  }).then(
                    () => {},
                    (error) => {
                      logger.info(error);
                    }
                  );
                  //..respond - complete the input data
                  locationInfos = {
                    suburb: body.address.suburb,
                    state: body.address.state,
                    location_name:
                      body.namedetails["name"] !== undefined &&
                      body.namedetails["name"] !== null
                        ? body.namedetails["name"]
                        : body.address.amenity !== undefined &&
                          body.address.amenity !== null
                        ? body.address.amenity
                        : body.address.road,
                    city: body.address.city,
                    country: body.address.country,
                    street_name:
                      body.address.road !== undefined &&
                      body.address.road !== null
                        ? body.address.road
                        : body.namedetails["name"],
                  };
                  resolve({
                    passenger_number_id:
                      locationInfos.passenger_number_id !== undefined &&
                      locationInfos.passenger_number_id !== null
                        ? locationInfos.passenger_number_id
                        : 1,
                    suburb: body.address.suburb,
                    state: body.address.state,
                    location_name:
                      body.namedetails["name"] !== undefined &&
                      body.namedetails["name"] !== null
                        ? body.namedetails["name"]
                        : body.address.amenity !== undefined &&
                          body.address.amenity !== null
                        ? body.address.amenity
                        : body.address.road,
                    city: body.address.city,
                    country: body.address.country,
                    street_name:
                      body.address.road !== undefined &&
                      body.address.road !== null
                        ? body.address.road
                        : body.namedetails["name"],
                  });
                } catch (error) {
                  resolve(false);
                }
              } //Error
              else {
                resolve(false);
              }
            } //error
            else {
              resolve(false);
            }
          } catch (error) {
            logger.info(error);
            resolve(false);
          }
        });
      }
    });
}

/**
 * @func estimateFullVehiclesCatPrices
 * @param resolve
 * @param completedInputData: input data that passed the integrity test and that was autocompleted ONLY!
 * @param collectionVehiclesInfos: collection of all the vehicle categories with their details (not explicit vehicles from mysql)
 * @param collectionNamibiaPricesLocationsMapWindhoek: collection of all the prices reference.
 * @param collectionNotFoundSubursPricesMap: collection of all not found suburbs prices map in the global maps
 * Responsible for determining the prices for each vehicle category based on the availability (should be available),
 * the country, city and the type of ride (RIDE or DELIVERY).
 * Actual cars from mysql MUST be linked the the corresponding vehicle category from mongo in order to receive targeted requests.
 */
function estimateFullVehiclesCatPrices(
  resolve,
  completedInputData,
  collectionVehiclesInfos,
  collectionPricesLocationsMap,
  collectionNotFoundSubursPricesMap
) {
  //DEBUG
  //completedInputData.pickup_location_infos.pickup_type = "Airport";
  //completedInputData.destination_location_infos[0].dropoff_type = "PrivateLocation";
  //completedInputData.destination_location_infos[1].dropoff_type = "Airport";
  //completedInputData.destination_location_infos[2].dropoff_type = "Airport";
  //completedInputData.destination_location_infos[3].dropoff_type = "PrivateLocation";
  //DEBUG
  //Check for the input data
  if (
    completedInputData.pickup_location_infos.suburb !== undefined &&
    completedInputData.pickup_location_infos.suburb !== false &&
    completedInputData.destination_location_infos[0].dropoff_type !==
      undefined &&
    completedInputData.destination_location_infos[0].dropoff_type !== false &&
    completedInputData.destination_location_infos[0].suburb !== undefined &&
    completedInputData.destination_location_infos[0].suburb !== false &&
    completedInputData.destination_location_infos[0].state !== undefined &&
    completedInputData.destination_location_infos[0].state !== false
  ) {
    //Check
    //Get the list of all the vehicles corresponding to the ride type (RIDE or DELIVERY), country, city and availability (AVAILABLE)
    let filterQuery = {
      ride_type: completedInputData.ride_mode,
      country: completedInputData.country,
      city: completedInputData.pickup_location_infos.city,
      availability: { $in: ["available", "unavailable"] },
    };

    collectionVehiclesInfos
      .find(filterQuery)
      .collation({ locale: "en", strength: 2 })
      .toArray(function (err, result) {
        logger.info(err);
        if (result !== undefined && result.length > 0) {
          //Found something
          let genericRidesInfos = result;
          //Get all the city's price map (cirteria: city, country and pickup)
          new Promise((res) => {
            filterQuery = {
              country: completedInputData.country,
              city: completedInputData.pickup_location_infos.city,
              pickup_suburb: completedInputData.pickup_location_infos.suburb
                .toUpperCase()
                .trim(),
            };
            collectionPricesLocationsMap
              .find(filterQuery)
              .collation({ locale: "en", strength: 2 })
              .toArray(function (err, result) {
                if (result.length > 0) {
                  //Found corresponding prices maps
                  res(result);
                } //No prices map found - Set default prices NAD 12 - non realistic and fixed prices
                else {
                  //Did not find suburbs with mathing suburbs included
                  //Register in mongo
                  new Promise((resX) => {
                    //Schema
                    //{point1_suburb:XXXX, point2_suburb:XXXX, city:XXX, country:XXX, date:XXX}
                    let queryNoMatch = {
                      point1_suburb:
                        completedInputData.pickup_location_infos.suburb,
                      point2_suburb: "ANY",
                      city: completedInputData.pickup_location_infos.city,
                      country: completedInputData.country,
                      date: new Date(chaineDateUTC),
                    };
                    let checkQuery = {
                      point1_suburb:
                        completedInputData.pickup_location_infos.suburb,
                      point2_suburb: "ANY",
                      city: completedInputData.pickup_location_infos.city,
                      country: completedInputData.country,
                    };
                    //Check to avoid duplicates
                    collectionNotFoundSubursPricesMap
                      .find(checkQuery)
                      .toArray(function (err, resultX) {
                        if (resultX.length <= 0) {
                          //New record
                          collectionNotFoundSubursPricesMap.insertOne(
                            queryNoMatch,
                            function (err, res) {
                              logger.info("New record added");
                              resX(true);
                            }
                          );
                        }
                      });
                  }).then(
                    () => {},
                    () => {}
                  );
                  res([
                    { pickup_suburb: false, fare: 12 },
                    { pickup_suburb: false, fare: 12 },
                    { pickup_suburb: false, fare: 12 },
                    { pickup_suburb: false, fare: 12 },
                  ]);
                }
              });
          }).then(
            (reslt) => {
              let globalPricesMap = reslt;
              //call computeInDepthPricesMap
              new Promise((res) => {
                computeInDepthPricesMap(
                  res,
                  completedInputData,
                  globalPricesMap,
                  genericRidesInfos,
                  collectionNotFoundSubursPricesMap
                );
              }).then(
                (reslt) => {
                  //DONE
                  if (reslt !== false) {
                    resolve(reslt);
                  } //Error
                  else {
                    resolve(false);
                  }
                },
                (error) => {
                  logger.info(error);
                  resolve(false);
                }
              );
            },
            (error) => {
              logger.info(error);
              resolve(false);
            }
          );
        } //No rides at all
        else {
          resolve({ response: "no_available_rides" });
        }
      });
  } //Invalid data
  else {
    logger.info("Invalid data");
    resolve(false);
  }
}

/**
 * @func computeInDepthPricesMap
 * @param resolve
 * @param completedInputData: completed operations input data
 * @param globalPricesMap: suburbs based prices reference
 * @param genericRidesInfos: generic vehicles categories
 * @param collectionNotFoundSubursPricesMap: collection of all not found suburbs from the global prices map.
 * Responsible for performing all the operations of header prices, multipliers (time and passengers) and outputing the final price map
 * ! DO NOT CACHE.
 */
function computeInDepthPricesMap(
  resolve,
  completedInputData,
  globalPricesMap,
  genericRidesInfos,
  collectionNotFoundSubursPricesMap
) {
  resolveDate();
  logger.info("compute in depth called");
  //ESTABLISH IMPORTANT PRICING VARIABLES
  let connectType = completedInputData.connect_type;
  let pickup_suburb = completedInputData.pickup_location_infos.suburb;
  let pickup_hour = (completedInputData.pickup_time / 1000) * 60 * 60;
  let pickup_minutes = pickup_hour * 60;
  let pickup_type = completedInputData.pickup_location_infos.pickup_type; //PrivateLocation, TaxiRank or Airport.
  let passengers_number = completedInputData.passengers_number; //Number of passengers for this ride.
  let request_country = completedInputData.country;
  //Compute header price and set timeDayMultiplier (multiplier x1 or x2 based on the time 00-4:59(x1) or 5:00-23:59(x2))
  //and passengersMultiplier (based on the number of passenger == just No of passengers)
  let headerPrice = 0;
  let timeDayMultiplier = 1;
  let passengersMultiplier = passengers_number;
  new Promise((res) => {
    if (pickup_hour >= 0 && pickup_hour <= 4) {
      //X2 multiplier 0AM-4AM
      timeDayMultiplier = 2;
    }
    //...
    if (/PrivateLocation/i.test(pickup_type)) {
      //+NAD5
      headerPrice += 5;
      res(true);
    } else if (/TaxiRank/i.test(pickup_type)) {
      //+NAD2
      headerPrice += 2;
      res(true);
    } else {
      res(true);
    }
  }).then(
    (reslt) => {
      logger.info("Pricing variables summary");
      logger.info(headerPrice, timeDayMultiplier, passengersMultiplier);
      //Find all the suburb based prices - applies very well to Windhoek
      genericRidesInfos.map((vehicle, index) => {
        let basePrice = 0; //Will contain the base price after going through all the destinations
        let isGoingToAirport = false; //To know whether or not the ride is heading to or from an airport.
        //Check if the pickup if an Airport
        //In case of an Airport, apply vehicle default airport price and mar as unavailable those not supporting
        //airport rides as pickup
        if (
          /Airport/i.test(pickup_type) &&
          /Eros Airport/i.test(
            completedInputData.pickup_location_infos.location_name
          ) === false
        ) {
          isGoingToAirport = true;
          //From Airport - mark vehicles that can't do airports as unavailable.
          if (vehicle.airport_rides == false) {
            //Can't do airport ride
            genericRidesInfos[index].availability = "unavailable";
          } //Can do airport rides - compute fare estimate - assign airport fare to base fare
          else {
            basePrice = vehicle.airport_rate;
          }
        } //Not airport (private location or taxi rank)
        else {
          //Check if connectMe or US
          //If connectMe, apply connect me rules, for comfort and luxury apply default price + header price
          if (/ConnectMe/i.test(connectType)) {
            //ConnectMe
            if (
              /Comfort/i.test(vehicle.category) ||
              /Luxury/i.test(vehicle.category)
            ) {
              //Comfort or luxury
              //Set to 0
              basePrice = 0;
            } //Economy
            else {
              //Apply passengers multiplier to fixed NAD45
              basePrice = 45 + 2.5 * (passengersMultiplier - 1);
            }
          } //ConnectUs
          else {
            //Just apply the time multiplier
            //Based on the regional suburb price map - assign base price to 0
            if (
              /Comfort/i.test(vehicle.category) ||
              /Luxury/i.test(vehicle.category)
            ) {
              //Comfort or luxury
              //SET to 0
              basePrice = 0;
            } //Economy
            else {
              //Set to 0
              basePrice = 0;
            }
          }
          //...
          completedInputData.destination_location_infos.map((destination) => {
            let tmpPickupPickup = pickup_suburb;
            let tmpDestinationSuburb = destination.suburb;
            //To Airport - mark vehicles that can't do airports as unavailable.
            if (
              /Airport/i.test(destination.dropoff_type) &&
              /Eros Airport/i.test(destination.location_name) === false
            ) {
              isGoingToAirport = true;
              //From Airport - mark vehicles that can't do airports as unavailable.
              if (vehicle.airport_rides == false) {
                //Can't do airport ride
                genericRidesInfos[index].availability = "unavailable";
              } //Can do airport rides - compute fare estimate - assign airport fare to base fare
              else {
                //Check for connectMe or US
                // remove count for one user and add base airport rate
                if (/ConnectMe/i.test(connectType)) {
                  if (
                    /Comfort/i.test(vehicle.category) ||
                    /Luxury/i.test(vehicle.category)
                  ) {
                    //Comfort or luxury
                    //Do nothing
                  } //Economy
                  else {
                    //Apply passengers multiplier to fixed NAD45
                    basePrice -= 2.5 * (passengersMultiplier - 1);
                  }
                } //For connectUs remove base price for 1 user considered if not 0
                else {
                  //Check corresponsing suburb fare
                  if (tmpPickupPickup === tmpDestinationSuburb) {
                    //Same suburb -> fare = base ride price
                    if (basePrice > 0) {
                      basePrice -= vehicle.base_fare;
                    }
                  } //Different suburb - find price and remove
                  else {
                    let lockPorgress = false; //Reponsible for avoiding repetitive removeal in case of FALSE suburb
                    globalPricesMap.map((suburbToSuburbInfo) => {
                      if (
                        suburbToSuburbInfo.pickup_suburb === false &&
                        lockPorgress === false
                      ) {
                        //Remove once
                        if (basePrice > 0) {
                          basePrice -= suburbToSuburbInfo.fare;
                          lockPorgress = true;
                        }
                      } else if (
                        suburbToSuburbInfo.pickup_suburb === tmpPickupPickup &&
                        suburbToSuburbInfo.destination_suburb ===
                          tmpDestinationSuburb
                      ) {
                        basePrice -= suburbToSuburbInfo.fare;
                      }
                    });
                  }
                }
                //APPLY AIRPORT RATE if not applied before
                if (basePrice < vehicle.airport_rate) {
                  //Price controller
                  basePrice += vehicle.airport_rate;
                }
              }
            } //Private location or taxi ranks - only for Economy and COnnectUS since for Luxury and comfort (connectMe) the price is already computed
            else {
              if (/ConnectUS/i.test(connectType)) {
                if (/RIDE/i.test(vehicle.ride_type)) {
                  //RIDES
                  if (/Economy/i.test(vehicle.category)) {
                    //Added up all the suburb related infos based on connect me of connectUS
                    let lockPorgress = false; //Reponsible for avoiding repetitive removeal in case of FALSE suburb
                    //Add base ride fare if the user is found to be going to the same suburb
                    if (tmpPickupPickup === tmpDestinationSuburb) {
                      //Same suburb -> fare = base ride price
                      basePrice += vehicle.base_fare;
                    }
                    let didFindRegisteredSuburbs = false; //To know whether or not has found registered suburbs or else did not find matching suburbs.
                    //...
                    globalPricesMap.map((suburbToSuburbInfo) => {
                      if (
                        suburbToSuburbInfo.pickup_suburb === false &&
                        lockPorgress === false
                      ) {
                        //Add once
                        if (basePrice > 0) {
                          //Add basic vehicle price instead of false suburb fare
                          //basePrice += suburbToSuburbInfo.fare;
                          basePrice += vehicle.base_fare;
                          lockPorgress = true;
                          didFindRegisteredSuburbs = true; //Found false suburbs-consider as registered.
                        }
                      } else if (
                        suburbToSuburbInfo.pickup_suburb !== false &&
                        destination.suburb !== false &&
                        new RegExp(
                          suburbToSuburbInfo.pickup_suburb.toUpperCase().trim(),
                          "i"
                        ).test(tmpPickupPickup.toUpperCase().trim()) &&
                        new RegExp(
                          suburbToSuburbInfo.destination_suburb
                            .toUpperCase()
                            .trim(),
                          "i"
                        ).test(destination.suburb.toUpperCase().trim())
                      ) {
                        lockPorgress = false;
                        didFindRegisteredSuburbs = true; //Found registered suburbs.
                        //If the car type is economy electric, add its base price
                        if (/electricEconomy/i.test(vehicle.car_type)) {
                          //logger.info(vehicle.base_fare);
                          //basePrice += vehicle.base_fare;
                          //? Remove N$2 discount for electric rides
                          basePrice += parseFloat(suburbToSuburbInfo.fare) - 2;
                        } //Normal taxis
                        else {
                          logger.info(suburbToSuburbInfo.fare);
                          logger.info(
                            completedInputData.destination_location_infos
                          );
                          logger.info(suburbToSuburbInfo);
                          basePrice += parseFloat(suburbToSuburbInfo.fare);
                        }
                      }
                    });
                    //...
                    if (didFindRegisteredSuburbs === false) {
                      //Did not find suburbs with mathing suburbs included
                      //Register in mongo
                      new Promise((resX) => {
                        //Schema
                        //{point1_suburb:XXXX, point2_suburb:XXXX, city:XXX, country:XXX, date:XXX}
                        let queryNoMatch = {
                          point1_suburb: tmpPickupPickup,
                          point2_suburb: tmpDestinationSuburb,
                          city: destination.city,
                          country: request_country,
                          date: new Date(chaineDateUTC),
                        };
                        let checkQuery = {
                          point1_suburb: tmpPickupPickup,
                          point2_suburb: tmpDestinationSuburb,
                          city: destination.city,
                          country: request_country,
                        };
                        //Check to avoid duplicates
                        collectionNotFoundSubursPricesMap
                          .find(checkQuery)
                          .toArray(function (err, resultX) {
                            if (resultX.length <= 0) {
                              //New record
                              collectionNotFoundSubursPricesMap.insertOne(
                                queryNoMatch,
                                function (err, res) {
                                  logger.info("New record added");
                                  resX(true);
                                }
                              );
                            }
                          });
                      }).then(
                        () => {},
                        () => {}
                      );
                      //Estimate a realistic price for now - EXTREMELY URGENT
                      //Assign ride base price
                      basePrice += vehicle.base_fare;
                    }
                  } else if (
                    /Comfort/i.test(vehicle.category) ||
                    /Luxury/i.test(vehicle.category)
                  ) {
                    //Add base fare for one person
                    basePrice += vehicle.base_fare;
                  }
                } else if (/DELIVERY/i.test(vehicle.ride_type)) {
                  //DELIVERIES
                  //Add base fare for one person
                  basePrice += vehicle.base_fare;
                }
              } //ConnectMe - for comfort and luxury only
              else {
                if (/RIDE/i.test(vehicle.ride_type)) {
                  //RIDES
                  if (
                    /Comfort/i.test(vehicle.category) ||
                    /Luxury/i.test(vehicle.category)
                  ) {
                    //Add base fare for one person
                    basePrice += vehicle.base_fare;
                  }
                } else if (/DELIVERY/i.test(vehicle.ride_type)) {
                  //DELIVERIES
                  //Add base fare for one person
                  basePrice += vehicle.base_fare;
                }
              }
            }
          });
        }
        //Add header price and time multiplier ONLY for the Economy category and not airport rides
        if (/Economy/i.test(vehicle.category) && isGoingToAirport === false) {
          basePrice *= timeDayMultiplier;
          basePrice += headerPrice; //Add header price LAST
        }
        //DONE update base price...
        //logger.info("ESTIMATED BASE PRICE (car type:", vehicle.car_type, ") --> ", basePrice);
        //Update the rides infos data
        genericRidesInfos[index].base_fare = basePrice;
        //Only get relevant information form the metadata
        let {
          category,
          ride_type,
          country,
          city,
          base_fare,
          car_type,
          app_label,
          media,
          availability,
        } = genericRidesInfos[index];
        genericRidesInfos[index] = {
          id: index,
          category: category,
          ride_type: ride_type,
          country: country,
          city: city,
          base_fare: base_fare,
          car_type: car_type,
          app_label: app_label,
          media: media,
          availability: availability,
        };
      });
      //Done respond
      logger.info("DONE computing prices");
      resolve(genericRidesInfos);
    },
    (error) => {
      logger.info(error);
      resolve(false);
    }
  );
}

/**
 * @func parsePricingInputData
 * @param resolve
 * @param inputData: data received, about the trip preferences from the user.
 * Responsible for checking and changing the received input data for the pricing service to the correct format.
 */
function parsePricingInputData(resolve, inputData) {
  //Just check for superficial usefingerprint, pickupData and destinationData
  if (
    inputData.user_fingerprint !== undefined &&
    inputData.user_fingerprint !== null &&
    inputData.pickupData !== undefined &&
    inputData.pickupData !== null &&
    inputData.destinationData !== undefined &&
    inputData.destinationData !== null
  ) {
    //...
    try {
      let cleanInputData = {};
      cleanInputData.user_fingerprint = inputData.user_fingerprint;
      cleanInputData.connect_type = inputData.connectType;
      cleanInputData.ride_mode = inputData.rideType;
      cleanInputData.passengers_number = inputData.passengersNo;
      cleanInputData.request_type = /now/i.test(inputData.timeScheduled)
        ? "immediate"
        : "scheduled";
      new Promise((res) => {
        //..Deduct the pickup time if scheduled
        if (/scheduled/i.test(cleanInputData.request_type)) {
          let timeExtracted = new Date(inputData.timeScheduled);
          let hourExtracted = timeExtracted.getHours();
          let minutesExtracted = timeExtracted.getMinutes();
          //Recreate now time
          let dateTMP = new Date();

          if (/tomorrow/i.test(inputData.timeScheduled)) {
            //Tomorrow, add 24h and do the same operation as above
            if (/Namibia/i.test(inputData.country))
              //GMT+2 in Namibia
              dateTMP = moment(dateTMP.getTime() + 86400000).utcOffset(2);
          }
          dateTMP =
            dateTMP.year() +
            "-" +
            (dateTMP.month() + 1) +
            "-" +
            dateTMP.date() +
            " " +
            hourExtracted +
            ":" +
            minutesExtracted +
            ":00";
          cleanInputData.pickup_time = dateTMP.millisecond() / 1000;
          res(true);
        } //Immediate request
        else {
          let tmpDate = new Date();
          cleanInputData.pickup_time = tmpDate.getTime() / 1000;
          res(true);
        }
        //...
      }).then(
        (reslt) => {
          //Continue parsing input data
          cleanInputData.country = inputData.country;
          cleanInputData.pickup_location_infos = {
            pickup_type: inputData.naturePickup,
            coordinates: {
              latitude: inputData.pickupData.coordinates[0],
              longitude: inputData.pickupData.coordinates[1],
            },
            location_name:
              inputData.pickupData.location_name !== undefined &&
              inputData.pickupData.location_name !== false
                ? inputData.pickupData.location_name
                : false,
            street_name:
              inputData.pickupData.street_name !== undefined &&
              inputData.pickupData.street_name !== false
                ? inputData.pickupData.street_name
                : false,
            suburb: false,
            state: false,
            city: inputData.pickupData.city,
          };

          new Promise((res) => {
            cleanInputData.destination_location_infos = [];
            let tmpSchemaArray = new Array(
              parseInt(cleanInputData.passengers_number)
            ).fill(1); //? Just for iterations, nothing more, instead of using for loop
            if (cleanInputData.passengers_number > 1) {
              //Many passengers
              //Check if all going to the same destination
              if (inputData.isAllGoingToSameDestination) {
                //yes
                tmpSchemaArray.map((element, index) => {
                  cleanInputData.destination_location_infos.push({
                    passenger_number_id: index + 1,
                    dropoff_type: false,
                    coordinates: {
                      latitude:
                        inputData.destinationData.passenger1Destination
                          .coordinates[0],
                      longitude:
                        inputData.destinationData.passenger1Destination
                          .coordinates[1],
                    },
                    location_name:
                      inputData.destinationData.passenger1Destination
                        .location_name !== undefined &&
                      inputData.destinationData.passenger1Destination
                        .location_name !== false
                        ? inputData.destinationData.passenger1Destination
                            .location_name
                        : false,
                    street_name:
                      inputData.destinationData.passenger1Destination.street !==
                        undefined &&
                      inputData.destinationData.passenger1Destination.street !==
                        false
                        ? inputData.destinationData.passenger1Destination.street
                        : false,
                    suburb: false,
                    state: false,
                    city: inputData.pickupData.city,
                  });
                });
                //Done
                res(cleanInputData);
              } //Independent destinations,.....:(
              else {
                if (cleanInputData.passengers_number == 2) {
                  //Passenger1
                  let passenger1Data =
                    inputData.destinationData.passenger1Destination;
                  cleanInputData.destination_location_infos.push({
                    passenger_number_id: 1,
                    dropoff_type: false,
                    coordinates: {
                      latitude: passenger1Data.coordinates[0],
                      longitude: passenger1Data.coordinates[1],
                    },
                    location_name:
                      passenger1Data.location_name !== undefined &&
                      passenger1Data.location_name !== false
                        ? passenger1Data.location_name
                        : false,
                    street_name:
                      passenger1Data.street !== undefined &&
                      passenger1Data.street !== false
                        ? passenger1Data.street
                        : false,
                    suburb: false,
                    state: false,
                    city: inputData.pickupData.city,
                  });
                  //Passenger2
                  let passenger2Data =
                    inputData.destinationData.passenger2Destination;
                  cleanInputData.destination_location_infos.push({
                    passenger_number_id: 2,
                    dropoff_type: false,
                    coordinates: {
                      latitude: passenger2Data.coordinates[0],
                      longitude: passenger2Data.coordinates[1],
                    },
                    location_name:
                      passenger2Data.location_name !== undefined &&
                      passenger2Data.location_name !== false
                        ? passenger2Data.location_name
                        : false,
                    street_name:
                      passenger2Data.street !== undefined &&
                      passenger2Data.street !== false
                        ? passenger2Data.street
                        : false,
                    suburb: false,
                    state: false,
                    city: inputData.pickupData.city,
                  });
                  //Done
                  res(cleanInputData);
                } else if (cleanInputData.passengers_number == 3) {
                  //Passenger1
                  let passenger1Data =
                    inputData.destinationData.passenger1Destination;
                  cleanInputData.destination_location_infos.push({
                    passenger_number_id: 1,
                    dropoff_type: false,
                    coordinates: {
                      latitude: passenger1Data.coordinates[0],
                      longitude: passenger1Data.coordinates[1],
                    },
                    location_name:
                      passenger1Data.location_name !== undefined &&
                      passenger1Data.location_name !== false
                        ? passenger1Data.location_name
                        : false,
                    street_name:
                      passenger1Data.street !== undefined &&
                      passenger1Data.street !== false
                        ? passenger1Data.street
                        : false,
                    suburb: false,
                    state: false,
                    city: inputData.pickupData.city,
                  });
                  //Passenger2
                  let passenger2Data =
                    inputData.destinationData.passenger2Destination;
                  cleanInputData.destination_location_infos.push({
                    passenger_number_id: 2,
                    dropoff_type: false,
                    coordinates: {
                      latitude: passenger2Data.coordinates[0],
                      longitude: passenger2Data.coordinates[1],
                    },
                    location_name:
                      passenger2Data.location_name !== undefined &&
                      passenger2Data.location_name !== false
                        ? passenger2Data.location_name
                        : false,
                    street_name:
                      passenger2Data.street !== undefined &&
                      passenger2Data.street !== false
                        ? passenger2Data.street
                        : false,
                    suburb: false,
                    state: false,
                    city: inputData.pickupData.city,
                  });
                  //Passenger3
                  let passenger3Data =
                    inputData.destinationData.passenger3Destination;
                  cleanInputData.destination_location_infos.push({
                    passenger_number_id: 3,
                    dropoff_type: false,
                    coordinates: {
                      latitude: passenger3Data.coordinates[0],
                      longitude: passenger3Data.coordinates[1],
                    },
                    location_name:
                      passenger3Data.location_name !== undefined &&
                      passenger3Data.location_name !== false
                        ? passenger3Data.location_name
                        : false,
                    street_name:
                      passenger3Data.street !== undefined &&
                      passenger3Data.street !== false
                        ? passenger3Data.street
                        : false,
                    suburb: false,
                    state: false,
                    city: inputData.pickupData.city,
                  });
                  //Done
                  res(cleanInputData);
                } else if (cleanInputData.passengers_number == 4) {
                  //Passenger1
                  let passenger1Data =
                    inputData.destinationData.passenger1Destination;
                  cleanInputData.destination_location_infos.push({
                    passenger_number_id: 1,
                    dropoff_type: false,
                    coordinates: {
                      latitude: passenger1Data.coordinates[0],
                      longitude: passenger1Data.coordinates[1],
                    },
                    location_name:
                      passenger1Data.location_name !== undefined &&
                      passenger1Data.location_name !== false
                        ? passenger1Data.location_name
                        : false,
                    street_name:
                      passenger1Data.street !== undefined &&
                      passenger1Data.street !== false
                        ? passenger1Data.street
                        : false,
                    suburb: false,
                    state: false,
                    city: inputData.pickupData.city,
                  });
                  //Passenger2
                  let passenger2Data =
                    inputData.destinationData.passenger2Destination;
                  cleanInputData.destination_location_infos.push({
                    passenger_number_id: 2,
                    dropoff_type: false,
                    coordinates: {
                      latitude: passenger2Data.coordinates[0],
                      longitude: passenger2Data.coordinates[1],
                    },
                    location_name:
                      passenger2Data.location_name !== undefined &&
                      passenger2Data.location_name !== false
                        ? passenger2Data.location_name
                        : false,
                    street_name:
                      passenger2Data.street !== undefined &&
                      passenger2Data.street !== false
                        ? passenger2Data.street
                        : false,
                    suburb: false,
                    state: false,
                    city: inputData.pickupData.city,
                  });
                  //Passenger3
                  let passenger3Data =
                    inputData.destinationData.passenger3Destination;
                  cleanInputData.destination_location_infos.push({
                    passenger_number_id: 3,
                    dropoff_type: false,
                    coordinates: {
                      latitude: passenger3Data.coordinates[0],
                      longitude: passenger3Data.coordinates[1],
                    },
                    location_name:
                      passenger3Data.location_name !== undefined &&
                      passenger3Data.location_name !== false
                        ? passenger3Data.location_name
                        : false,
                    street_name:
                      passenger3Data.street !== undefined &&
                      passenger3Data.street !== false
                        ? passenger3Data.street
                        : false,
                    suburb: false,
                    state: false,
                    city: inputData.pickupData.city,
                  });
                  //Passenger4
                  let passenger4Data =
                    inputData.destinationData.passenger4Destination;
                  cleanInputData.destination_location_infos.push({
                    passenger_number_id: 4,
                    dropoff_type: false,
                    coordinates: {
                      latitude: passenger4Data.coordinates[0],
                      longitude: passenger4Data.coordinates[1],
                    },
                    location_name:
                      passenger4Data.location_name !== undefined &&
                      passenger4Data.location_name !== false
                        ? passenger4Data.location_name
                        : false,
                    street_name:
                      passenger4Data.street !== undefined &&
                      passenger4Data.street !== false
                        ? passenger4Data.street
                        : false,
                    suburb: false,
                    state: false,
                    city: inputData.pickupData.city,
                  });
                  //Done
                  res(cleanInputData);
                }
              }
            } //Single passenger
            else {
              cleanInputData.destination_location_infos.push({
                passenger_number_id: 1,
                dropoff_type: false,
                coordinates: {
                  latitude:
                    inputData.destinationData.passenger1Destination
                      .coordinates[0],
                  longitude:
                    inputData.destinationData.passenger1Destination
                      .coordinates[1],
                },
                location_name:
                  inputData.destinationData.passenger1Destination
                    .location_name !== undefined &&
                  inputData.destinationData.passenger1Destination
                    .location_name !== false
                    ? inputData.destinationData.passenger1Destination
                        .location_name
                    : false,
                street_name:
                  inputData.destinationData.passenger1Destination.street !==
                    undefined &&
                  inputData.destinationData.passenger1Destination.street !==
                    false
                    ? inputData.destinationData.passenger1Destination.street
                    : false,
                suburb: false,
                state: false,
                city: inputData.pickupData.city,
              });
              res(cleanInputData);
            }
          }).then(
            (reslt) => {
              //DONE
              resolve(reslt);
            },
            (error) => {
              resolve(false);
            }
          );
        },
        (error) => {
          resolve(false);
        }
      );
    } catch (error) {
      logger.info(error);
      resolve(false);
    }
  } //Invalid data
  else {
    resolve(false);
  }
}

/**
 * Pricing service
 * Responsible for computing all the price estimates for evey vehicle type based on any type of requests (RIDE or DELIVERY)
 * and also return the status (available - can be selected, unavailable - can't be selected) of each vehicle to enable or disable selection in-app.
 */
redisCluster.on("connect", function () {
  logger.info("[*] Redis connected");
  clientMongo.connect(function (err) {
    //if (err) throw err;
    logger.info("[+] Pricing service active");
    const dbMongo = clientMongo.db(process.env.DB_NAME_MONGODDB);
    const collectionVehiclesInfos = dbMongo.collection(
      "vehicles_collection_infos"
    ); //Collection containing the list of all the vehicles types and all their corresponding infos
    const collectionPricesLocationsMap = dbMongo.collection(
      "global_prices_to_locations_map"
    ); //Collection containing all the prices and locations in a format
    const collectionSavedSuburbResults = dbMongo.collection(
      "autocompleted_location_suburbs"
    ); //Collection of all the location matching will all their corresponding suburbs and other fetched infos
    const collectionNotFoundSubursPricesMap = dbMongo.collection(
      "not_found_suburbs_prices_map"
    ); //Colleciton of all suburbs prices that where not found in the global prices map.
    //-------------
    const bodyParser = require("body-parser");
    app
      .get("/", function (req, res) {
        res.send("Pricing services up");
      })
      .use(
        bodyParser.json({
          limit: process.env.MAX_DATA_BANDWIDTH_EXPRESS,
          extended: true,
        })
      )
      .use(
        bodyParser.urlencoded({
          limit: process.env.MAX_DATA_BANDWIDTH_EXPRESS,
          extended: true,
        })
      );
    //-------------------------------

    /**
     * Get the price estimates for every single vehicle types available.
     */
    app.post("/getOverallPricingAndAvailabilityDetails", function (req, res) {
      new Promise((resMAIN) => {
        resolveDate();
        //DELIVERY TEST DATA - DEBUG
        /*let deliveryPricingInputDataRaw = {
          user_fingerprint:
            "4ec9a3cac550584cfe04108e63b61961af32f9162ca09bee59bc0fc264c6dd1d61dbd97238a27e147e1134e9b37299d160c0f0ee1c620c9f012e3a08a4505fd6",
          connectType: "ConnectUs",
          country: "Namibia",
          isAllGoingToSameDestination: true,
          naturePickup: "PrivateLocation", //Force PrivateLocation type if nothing found
          passengersNo: 3, //Default 2 possible destination
          rideType: "RIDE",
          timeScheduled: "Now",
          pickupData: {
            coordinates: [-22.611291, 17.071366],
            location_name: "Academia",
            street_name: "Academia",
            city: "Windhoek",
          },
          destinationData: {
            passenger1Destination: {
              coordinates: [-22.605981, 17.096875],
              location_name: "Suiderhof",
              street: "Suiderhof",
              city: "Windhoek",
            },
            passenger2Destination: {
              coordinates: [-22.522764, 17.056328],
              location_name: "Katutura",
              street: "Police station",
              city: "Windhoek",
            },
            passenger3Destination: {
              coordinates: [-22.522764, 17.056328],
              location_name: "Katutura",
              street: "Police station",
              city: "Windhoek",
            },
            passenger2Destination: false,
            passenger3Destination: false,
            passenger4Destination: false,
          },
        };
        req.body = deliveryPricingInputDataRaw;*/
        logger.info(req.body);
        //...

        try {
          let inputDataInitial = req.body;
          //Parse input to the correct format
          //Parse input date to the good format
          new Promise((res) => {
            parsePricingInputData(res, inputDataInitial);
          }).then(
            (reslt) => {
              if (reslt !== false) {
                let parsedData = reslt; //Clean parsed data
                if (checkInputIntegrity(parsedData)) {
                  //Check inetgrity
                  logger.info("Passed the integrity test.");
                  //Valid input
                  //Autocomplete the input data
                  new Promise((res) => {
                    autocompleteInputData(
                      res,
                      parsedData,
                      collectionSavedSuburbResults
                    );
                  }).then(
                    (result) => {
                      if (result !== false) {
                        let completeInput = result;
                        logger.info("Done autocompleting");
                        //Generate prices metadata for all the relevant vehicles categories
                        logger.info(
                          "Computing prices metadata of relevant car categories"
                        );
                        new Promise((res) => {
                          estimateFullVehiclesCatPrices(
                            res,
                            completeInput,
                            collectionVehiclesInfos,
                            collectionPricesLocationsMap,
                            collectionNotFoundSubursPricesMap
                          );
                        }).then(
                          (result) => {
                            logger.info("DOne computing fares");
                            resMAIN(result);
                          },
                          (error) => {
                            logger.info(error);
                            resMAIN({
                              response: "Failed perform the operations",
                            });
                          }
                        );
                        //...
                      } //Error - Failed input augmentation
                      else {
                        resMAIN({ response: "Failed input augmentation" });
                      }
                    },
                    (error) => {
                      //Error - Failed input augmentation
                      logger.info(error);
                      resMAIN({ response: "Failed input augmentation" });
                    }
                  );
                } //Invalid input data
                else {
                  resMAIN({ response: "Failed integrity" });
                }
              } //Faild parsing
              else {
                resMAIN({ response: "Failed parsing." });
              }
            },
            (error) => {
              resMAIN({ response: "Failed parsing." });
            }
          );
        } catch (error) {
          logger.info(error);
          resMAIN({ response: "Failed parsing." });
        }
      })
        .then((result) => {
          res.send(result);
        })
        .catch((error) => {
          logger.info(error);
          res.send({
            response: "Failed perform the operations",
          });
        });
    });

    /**
     * GET SUBURBS INFORMATION
     * [Should be moved to the MAP service]
     * Resposible for getting the corresponding suburbs for provided location.
     * Input data: location name, street name, city, country and coordinates (obj, lat and long)
     */
    app.get("/getCorrespondingSuburbInfos", function (req, res) {
      new Promise((resMAIN) => {
        let params = urlParser.parse(req.url, true);
        req = params.query;
        logger.info(req);

        if (req !== undefined && req.user_fingerprint !== undefined) {
          new Promise((res) => {
            doMongoSearchForAutocompletedSuburbs(
              res,
              {
                location_name: req.location_name,
                street_name: req.street_name,
                city: req.city,
                country: req.country,
                coordinates: {
                  latitude: req.latitude,
                  longitude: req.longitude,
                },
                make_new:
                  req.make_new !== undefined && req.make_new !== null
                    ? true
                    : false,
              },
              collectionSavedSuburbResults
            );
          }).then(
            (result) => {
              logger.info(result);
              resMAIN(result);
            },
            (error) => {
              logger.info(error);
              resMAIN(false);
            }
          );
        } else {
          resMAIN(false);
        }
      })
        .then((result) => {
          res.send(result);
        })
        .catch((error) => {
          logger.info(error);
          res.send(false);
        });
    });

    /**
     * GET BACH DESTINATION SUBURBS AND LOCATION TYPE
     * Responsible for autocompleting the suburbs and location types of locations (external to this service)
     * Input data: @array containing compatible parsed data of locations
     */
    app.post("/manageAutoCompleteSuburbsAndLocationTypes", function (req, res) {
      new Promise((resMAIN) => {
        let arrayData = req.body;
        logger.info(arrayData);
        new Promise((res) => {
          manageAutoCompleteDestinationLocations(
            res,
            arrayData.locationData,
            arrayData.user_fingerprint,
            collectionSavedSuburbResults
          );
        }).then(
          (result) => {
            if (result !== false) {
              //DONE AUTOCOMPLETING
              resMAIN(result);
            } //Error
            else {
              resMAIN(false);
            }
          },
          (error) => {
            logger.info(error);
            resMAIN(false);
          }
        );
      })
        .then((result) => {
          res.send(result);
        })
        .catch((error) => {
          logger.info(error);
          res.send(false);
        });
    });
  });
});

server.listen(process.env.PRICING_SERVICE_PORT);
