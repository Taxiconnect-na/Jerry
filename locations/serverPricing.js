var dash = require("appmetrics-dash");
var express = require("express");
const http = require("http");
const fs = require("fs");
const geolocationUtlis = require("geolocation-utils");
const taxiRanksDb = JSON.parse(fs.readFileSync("taxiRanks_points.txt", "utf8"));
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
const urlParser = require("url");
const redis = require("redis");
const client = redis.createClient();
const redisGet = promisify(client.get).bind(client);

var chaineDateUTC = null;
var dateObject = null;
const moment = require("moment");
const e = require("express");

const URL_MONGODB = "mongodb://localhost:27017";
const DB_NAME_MONGODB = "geospatial_and_vehicles_schemaless";
const URL_SEARCH_SERVICES = "http://www.taxiconnectna.com:7007/";
const URL_ROUTE_SERVICES = "http://www.taxiconnectna.com:7008/route?";
const URL_NOMINATIM_SERVICES = "http://taxiconnectna.com:9009";
const EVENTS_GATEWAY_HOST = "localhost";
const EVENTS_GATEWAY_PORT = 9097;
const MAP_SERVICE_HOST = "localhost";
const MAP_SERVICE_PORT = 9090;

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

const port = 8989;

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
        if (destinationInfos[0].passenger_number_id !== undefined && destinationInfos[0].passenger_number_id !== null) {
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
 * key: savedSuburbResults
 * data: [{}, {}, ...]
 */
function autocompleteInputData(resolve, inputData, collectionSavedSuburbResults) {
  let pickupInfos = inputData.pickup_location_infos;
  let destinationInfos = inputData.destination_location_infos;
  //[PICKUP LOCATION] Complete pickup location suburb infos
  //Check Redis for previous record
  redisGet("savedSuburbResults").then(
    (resp) => {
      console.log(resp);
      if (resp !== null && resp !== undefined) {
        //Found a record
        resp = JSON.parse(resp);
        console.log("Found something in the cache");
        //Check if there's our concerned record for the pickup location
        let focusedRecord = false;
        resp.map((location) => {
          if (
            location.location_name === pickupInfos.location_name &&
            location.city === pickupInfos.city &&
            location.street_name === pickupInfos.street_name
          ) {
            //Found
            focusedRecord = location;
          }
        });
        //Check for wanted record
        if (focusedRecord !== false) {
          //Found something
          console.log("Found a wanted cached record.");
          inputData.pickup_location_infos.suburb = focusedRecord.suburb; //Update main object
          inputData.pickup_location_infos.state = focusedRecord.state;
          pickupInfos = inputData.pickup_location_infos.state; //Update shortcut var
          //...Done auto complete destination locations
          new Promise((res) => {
            manageAutoCompleteDestinationLocations(res, destinationInfos, inputData.user_fingerprint, collectionSavedSuburbResults);
          }).then(
            (result) => {
              if (result !== false) {
                inputData.destination_location_infos = result; //Update main object
                destinationInfos = result; //Update shortcut object
                //DONE AUTOCOMPLETING
                resolve(inputData);
              } //Error
              else {
                resolve(false);
              }
            },
            (error) => {
              console.log(error);
              resolve(false);
            }
          );
        } //No wanted record - do a fresh search
        else {
          new Promise((res) => {
            doMongoSearchForAutocompletedSuburbs(res, pickupInfos, collectionSavedSuburbResults);
          }).then(
            (result) => {
              if (result !== false) {
                inputData.pickup_location_infos.suburb = result.suburb; //Update main object
                inputData.pickup_location_infos.state = result.state;
                pickupInfos = inputData.pickup_location_infos; //Update shortcut var
                //...Done auto complete destination locations
                //console.log(result);
                new Promise((res) => {
                  manageAutoCompleteDestinationLocations(res, destinationInfos, inputData.user_fingerprint, collectionSavedSuburbResults);
                }).then(
                  (result) => {
                    if (result !== false) {
                      inputData.destination_location_infos = result; //Update main object
                      destinationInfos = result; //Update shortcut object
                      //DONE AUTOCOMPLETING
                      resolve(inputData);
                    } //Error
                    else {
                      resolve(false);
                    }
                  },
                  (error) => {
                    console.log(error);
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
        console.log("[No cache] No cached data, do mongo search");
        new Promise((res) => {
          doMongoSearchForAutocompletedSuburbs(res, pickupInfos, collectionSavedSuburbResults);
        }).then(
          (result) => {
            if (result !== false) {
              inputData.pickup_location_infos.suburb = result.suburb; //Update main object
              inputData.pickup_location_infos.state = result.state;
              pickupInfos = inputData.pickup_location_infos; //Update shortcut var
              //...Done auto complete destination locations
              //console.log(result);
              new Promise((res) => {
                manageAutoCompleteDestinationLocations(res, destinationInfos, inputData.user_fingerprint, collectionSavedSuburbResults);
              }).then(
                (result) => {
                  if (result !== false) {
                    inputData.destination_location_infos = result; //Update main object
                    destinationInfos = result; //Update shortcut object
                    //DONE AUTOCOMPLETING
                    resolve(inputData);
                  } //Error
                  else {
                    resolve(false);
                  }
                },
                (error) => {
                  console.log(error);
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
      console.log("Error, No cached data, do mongo search");
      new Promise((res) => {
        doMongoSearchForAutocompletedSuburbs(res, pickupInfos, collectionSavedSuburbResults);
      }).then(
        (result) => {
          if (result !== false) {
            inputData.pickup_location_infos.suburb = result.suburb; //Update main object
            inputData.pickup_location_infos.state = result.state;
            pickupInfos = inputData.pickup_location_infos; //Update shortcut var
            //...Done auto complete destination locations
            new Promise((res) => {
              manageAutoCompleteDestinationLocations(res, destinationInfos, inputData.user_fingerprint, collectionSavedSuburbResults);
            }).then(
              (result) => {
                if (result !== false) {
                  inputData.destination_location_infos = result; //Update main object
                  destinationInfos = result; //Update shortcut object
                  //DONE AUTOCOMPLETING
                  resolve(inputData);
                } //Error
                else {
                  resolve(false);
                }
              },
              (error) => {
                console.log(error);
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
  );
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
 * key: destinationLocationsAutoCompletedNature: [{location_name, street_name, suburb, city, locationType}]
 */
function manageAutoCompleteDestinationLocations(resolve, destinationLocations, user_fingerprint, collectionSavedSuburbResults) {
  console.log("AUTO COMPLETE DESTINATION DATA");
  let promiseParent = destinationLocations.map((destination) => {
    return new Promise((res) => {
      doMongoSearchForAutocompletedSuburbs(res, destination, collectionSavedSuburbResults);
    });
  });
  Promise.all(promiseParent).then(
    (result) => {
      if (result !== false) {
        ////console.log(result);
        //Update the input data
        destinationLocations.map((prevLocation, index) => {
          result.map((completeLocation) => {
            if (
              completeLocation.location_name === prevLocation.location_name &&
              completeLocation.street_name === prevLocation.street_name &&
              completeLocation.city === prevLocation.city
            ) {
              //Same location - update - else ignore
              destinationLocations[index].suburb = completeLocation.suburb;
              destinationLocations[index].state = completeLocation.state;
            }
          });
        });
        //Autocomplete the location types : taxi rank, airports or private locations
        let promiseParent2 = destinationLocations.map((destination) => {
          //Check if a cached data is present
          redisGet("destinationLocationsAutoCompletedNature").then((reslt) => {
            if (reslt !== null) {
              //Has a record
              //CHeck if contains the focused record
              try {
                reslt = JSON.parse(reslt);
                let wasFocusedLocationCached = false;
                reslt.map((locationCached) => {
                  if (
                    locationCached.location_name === destination.location_name &&
                    locationCached.street_name === destination.street_name &&
                    locationCached.suburb === destination.suburb &&
                    locationCached.city === destination.city
                  ) {
                    //Found update destination
                    destination.locationType = locationCached.locationType;
                    wasFocusedLocationCached = true;
                  }
                });
                //...
                if (wasFocusedLocationCached === false) {
                  //Not found - do a new search
                  return new Promise((res) => {
                    let url =
                      MAP_SERVICE_HOST +
                      ":" +
                      MAP_SERVICE_PORT +
                      "/identifyPickupLocation?latitude=" +
                      destination.coordinates.latitude +
                      "&longitude=" +
                      destination.coordinates.longitude +
                      "&user_fingerprint=" +
                      user_fingerprint;
                    requestAPI(url, function (error, response, body) {
                      console.log(body);
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
                }
              } catch (error) {
                return new Promise((res) => {
                  let url =
                    MAP_SERVICE_HOST +
                    ":" +
                    MAP_SERVICE_PORT +
                    "/identifyPickupLocation?latitude=" +
                    destination.coordinates.latitude +
                    "&longitude=" +
                    destination.coordinates.longitude +
                    "&user_fingerprint=" +
                    user_fingerprint;
                  requestAPI(url, function (error, response, body) {
                    console.log(body);
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
              }
            } //No records - make a fresh search
            else {
              return new Promise((res) => {
                let url =
                  MAP_SERVICE_HOST +
                  ":" +
                  MAP_SERVICE_PORT +
                  "/identifyPickupLocation?latitude=" +
                  destination.coordinates.latitude +
                  "&longitude=" +
                  destination.coordinates.longitude +
                  "&user_fingerprint=" +
                  user_fingerprint;
                requestAPI(url, function (error, response, body) {
                  console.log(body);
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
            }
          });
        });
        //..
        Promise.all(promiseParent2).then(
          (result) => {
            result.map((location) => {
              if (location !== undefined && location.passenger_number_id !== undefined) {
                //Linked to a user
                destinationLocations[location.passenger_number_id - 1].dropoff_type = location.locationType;
                //Cache the location
                new Promise((res) => {
                  //Check if redis already have key record
                  redisGet("destinationLocationsAutoCompletedNature").then(
                    (reslt) => {
                      if (reslt !== null) {
                        //Has record - just update
                        try {
                          reslt = JSON.parse(reslt);
                          reslt.push({
                            location_name: destinationLocations.location_name,
                            street_name: destinationLocations.street_name,
                            suburb: destinationLocations.suburb,
                            city: destinationLocations.city,
                            locationType: location.locationType,
                          });
                          client.set("destinationLocationsAutoCompletedNature", JSON.stringify(reslt));
                          res(true);
                        } catch (error) {
                          let recordTmp = {
                            location_name: destinationLocations.location_name,
                            street_name: destinationLocations.street_name,
                            suburb: destinationLocations.suburb,
                            city: destinationLocations.city,
                            locationType: location.locationType,
                          };
                          client.set("destinationLocationsAutoCompletedNature", JSON.stringify(recordTmp));
                          res(true);
                        }
                      } //No record - create one - [{location_name, street_name, suburb, city, locationType}]
                      else {
                        let recordTmp = {
                          location_name: destinationLocations.location_name,
                          street_name: destinationLocations.street_name,
                          suburb: destinationLocations.suburb,
                          city: destinationLocations.city,
                          locationType: location.locationType,
                        };
                        client.set("destinationLocationsAutoCompletedNature", JSON.stringify(recordTmp));
                        res(true);
                      }
                    },
                    (error) => {
                      console.log(error);
                      res(false);
                    }
                  );
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
            console.log(error);
            destinationLocations.map((location, index) => {
              destinationLocations[index].dropoff_type = "PrivateLocation";
            });
            resolve(destinationLocations);
          }
        );
      } else {
        resolve(false);
      }
    },
    (error) => {
      console.log(error);
      resolve(false);
    }
  );
}

/**
 * @func doMongoSearchForAutocompletedSuburbs
 * @param locationInfos: object containing specific single location infos
 * @param resolve
 * @param collectionSavedSuburbResults: collection containing all the already proccessed records
 * Responsible for checking in mongodb for previous exact record already searched.
 */
function doMongoSearchForAutocompletedSuburbs(resolve, locationInfos, collectionSavedSuburbResults) {
  //Check mongodb for previous record
  let findPrevQuery = { location_name: locationInfos.location_name, city: locationInfos.city, street_name: locationInfos.street_name };
  collectionSavedSuburbResults.find(findPrevQuery).toArray(function (err, result) {
    if (result.length > 0) {
      //Found previous record
      resolve(result[0]);
    } //Do a fresh search
    else {
      let url =
        URL_NOMINATIM_SERVICES +
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
            if (body.address.state !== undefined && body.address.suburb !== undefined) {
              console.log("fresh search done!");
              new Promise((res1) => {
                //Save result in MongoDB
                let newRecord = {
                  suburb: body.address.suburb,
                  state: body.address.state,
                  location_name: locationInfos.location_name,
                  city: locationInfos.city,
                  street_name: locationInfos.street_name,
                };

                collectionSavedSuburbResults.insertOne(newRecord, function (err, reslt) {
                  console.log("Saved new record in mongo");
                  res1(true);
                });
              }).then(
                () => {},
                () => {}
              );

              //Cache result
              new Promise((res2) => {
                redisGet("savedSuburbResults").then(
                  (reslt) => {
                    let prevCache = null;
                    if (reslt !== null && reslt !== undefined) {
                      try {
                        prevCache = JSON.parse(reslt);
                        //[REVIEW] MIGHT PROBABLY WANNA CHECK TO AVOID DUPLICATES
                        prevCache.push({
                          suburb: body.address.suburb,
                          state: body.address.state,
                          location_name: locationInfos.location_name,
                          city: locationInfos.city,
                          street_name: locationInfos.street_name,
                        });
                        //add new record
                        client.set("savedSuburbResults", JSON.stringify(prevCache), redis.print);
                        res2(true);
                      } catch (error) {
                        console.log(error);
                        res2(false);
                      }
                    } //No records yet do a new one
                    else {
                      prevCache = [];
                      //[REVIEW] MIGHT PROBABLY WANNA CHECK TO AVOID DUPLICATES
                      prevCache.push({
                        suburb: body.address.suburb,
                        state: body.address.state,
                        location_name: locationInfos.location_name,
                        city: locationInfos.city,
                        street_name: locationInfos.street_name,
                      });
                      //add new record
                      client.set("savedSuburbResults", JSON.stringify(prevCache), redis.print);
                      res2(true);
                    }
                  },
                  (error) => {
                    console.log(error);
                    res2(false);
                  }
                );
              }).then(
                () => {},
                (error) => {
                  console.log(error);
                }
              );
              //..respond - complete the input data
              locationInfos.suburb = body.address.suburb;
              locationInfos.state = body.address.state;
              resolve(locationInfos);
            } //Error
            else {
              resolve(false);
            }
          } //error
          else {
            resolve(false);
          }
        } catch (error) {
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
 * @param collectionNamibiaPricesLocationsMapWindhoek: collection of all the prices reference for the city of Windhoek exclusively.
 * Responsible for determining the prices for each vehicle category based on the availability (should be available),
 * the country, city and the type of ride (RIDE or DELIVERY).
 * Actual cars from mysql MUST be linked the the corresponding vehicle category from mongo in order to receive targeted requests.
 */
function estimateFullVehiclesCatPrices(resolve, completedInputData, collectionVehiclesInfos, collectionPricesLocationsMap) {
  //DEBUG
  //completedInputData.pickup_location_infos.pickup_type = "Airport";
  completedInputData.destination_location_infos[0].dropoff_type = "PrivateLocation";
  completedInputData.destination_location_infos[1].dropoff_type = "Airport";
  completedInputData.destination_location_infos[2].dropoff_type = "Airport";
  completedInputData.destination_location_infos[3].dropoff_type = "PrivateLocation";
  //DEBUG
  //Check for the input data
  if (
    completedInputData.pickup_location_infos.suburb !== undefined &&
    completedInputData.pickup_location_infos.suburb !== false &&
    completedInputData.destination_location_infos[0].dropoff_type !== undefined &&
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
      availability: "available",
    };
    collectionVehiclesInfos.find(filterQuery).toArray(function (err, result) {
      //console.log(result);
      if (result.length > 0) {
        //Found something
        let genericRidesInfos = result;
        //Get all the city's price map (cirteria: city, country and pickup)
        new Promise((res) => {
          filterQuery = {
            country: completedInputData.country,
            city: completedInputData.pickup_location_infos.city,
            pickup_suburb: completedInputData.pickup_location_infos.suburb.toUpperCase().trim(),
          };
          collectionPricesLocationsMap.find(filterQuery).toArray(function (err, result) {
            if (result.length > 0) {
              //Found corresponding prices maps
              res(result);
            } //No prices map found - Set default prices NAD 12 - non realistic and fixed prices
            else {
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
              computeInDepthPricesMap(res, completedInputData, globalPricesMap, genericRidesInfos);
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
                console.log(error);
                resolve(false);
              }
            );
          },
          (error) => {
            console.log(error);
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
    console.log("Invalid data");
    resolve(false);
  }
}

/**
 * @func computeInDepthPricesMap
 * @param resolve
 * @param completedInputData: completed operations input data
 * @param globalPricesMap: suburbs based prices reference
 * @param genericRidesInfos: generic vehicles categories
 * Responsible for performing all the operations of header prices, multipliers (time and passengers) and outputing the final price map
 */
function computeInDepthPricesMap(resolve, completedInputData, globalPricesMap, genericRidesInfos) {
  console.log("compute in depth called");
  //ESTABLISH IMPORTANT PRICING VARIABLES
  let connectType = completedInputData.connect_type;
  let pickup_suburb = completedInputData.pickup_location_infos.suburb;
  let pickup_hour = (completedInputData.pickup_time / 1000) * 60 * 60;
  let pickup_minutes = pickup_hour * 60;
  let pickup_type = completedInputData.pickup_location_infos.pickup_type; //PrivateLocation, TaxiRank or Airport.
  let passengers_number = completedInputData.passengers_number; //Number of passengers for this ride.
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
      console.log("Pricing variables summary");
      console.log(headerPrice, timeDayMultiplier, passengersMultiplier);
      //Find all the suburb based prices - applies very well to Windhoek
      genericRidesInfos.map((vehicle, index) => {
        let basePrice = 0; //Will contain the base price after going through all the destinations
        let isGoingToAirport = false; //To know whether or not the ride is heading to or from an airport.
        //Check if the pickup if an Airport
        //In case of an Airport, apply vehicle default airport price and mar as unavailable those not supporting
        //airport rides as pickup
        if (/Airport/i.test(pickup_type)) {
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
            if (/Comfort/i.test(vehicle.category) || /Luxury/i.test(vehicle.category)) {
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
            if (/Comfort/i.test(vehicle.category) || /Luxury/i.test(vehicle.category)) {
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
            if (/Airport/i.test(destination.dropoff_type)) {
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
                  if (/Comfort/i.test(vehicle.category) || /Luxury/i.test(vehicle.category)) {
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
                      if (suburbToSuburbInfo.pickup_suburb === false && lockPorgress === false) {
                        //Remove once
                        if (basePrice > 0) {
                          basePrice -= suburbToSuburbInfo.fare;
                          lockPorgress = true;
                        }
                      } else if (
                        suburbToSuburbInfo.pickup_suburb === tmpPickupPickup &&
                        suburbToSuburbInfo.destination_suburb === tmpDestinationSuburb
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
                if (/Economy/i.test(vehicle.category)) {
                  //Added up all the suburb related infos based on connect me of connectUS
                  let lockPorgress = false; //Reponsible for avoiding repetitive removeal in case of FALSE suburb
                  //Add base ride fare if the user is found to be going to the same suburb
                  if (tmpPickupPickup === tmpDestinationSuburb) {
                    console.log(vehicle.base_fare);
                    //Same suburb -> fare = base ride price
                    basePrice += vehicle.base_fare;
                  }
                  globalPricesMap.map((suburbToSuburbInfo) => {
                    if (suburbToSuburbInfo.pickup_suburb === false && lockPorgress === false) {
                      //Add once
                      if (basePrice > 0) {
                        basePrice += suburbToSuburbInfo.fare;
                        lockPorgress = true;
                      }
                    } else if (
                      suburbToSuburbInfo.pickup_suburb.toUpperCase().trim() === tmpPickupPickup.toUpperCase().trim() &&
                      suburbToSuburbInfo.destination_suburb.toUpperCase().trim() === tmpDestinationSuburb.toUpperCase().trim()
                    ) {
                      lockPorgress = false;
                      //If the car type is economy electric, add its base price
                      if (/electricEconomy/i.test(vehicle.car_type)) {
                        console.log(vehicle.base_fare);
                        basePrice += vehicle.base_fare;
                      } //Normal taxis
                      else {
                        console.log(suburbToSuburbInfo.fare);
                        basePrice += suburbToSuburbInfo.fare;
                      }
                    }
                  });
                } else if (/Comfort/i.test(vehicle.category) || /Luxury/i.test(vehicle.category)) {
                  //Add base fare for one person
                  basePrice += vehicle.base_fare;
                }
              } //ConnectMe - for comfort and luxury only
              else {
                if (/Comfort/i.test(vehicle.category) || /Luxury/i.test(vehicle.category)) {
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
        //console.log("ESTIMATED BASE PRICE (car type:", vehicle.car_type, ") --> ", basePrice);
        //Update the rides infos data
        genericRidesInfos[index].base_fare = basePrice;
        //Only get relevant information form the metadata
        let { category, ride_type, country, city, base_fare, car_type, app_label, media, availability } = genericRidesInfos[index];
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
      console.log("DONE computing prices");
      resolve(genericRidesInfos);
    },
    (error) => {
      console.log(error);
      resolve(false);
    }
  );
}

//Database connection
const dbPool = mysql.createPool({
  connectionLimit: 1000000000,
  host: "localhost",
  database: "taxiconnect",
  user: "root",
  password: "",
});

/**
 * Pricing service
 * Responsible for computing all the price estimates for evey vehicle type based on any type of requests (RIDE or DELIVERY)
 * and also return the status (available - can be selected, unavailable - can't be selected) of each vehicle to enable or disable selection in-app.
 */

dbPool.getConnection(function (err, connection) {
  clientMongo.connect(function (err) {
    //if (err) throw err;
    console.log("[+] Pricing service active");
    const dbMongo = clientMongo.db(DB_NAME_MONGODB);
    const collectionVehiclesInfos = dbMongo.collection("vehicles_collection_infos"); //Collection containing the list of all the vehicles types and all their corresponding infos
    const collectionPricesLocationsMap = dbMongo.collection("global_prices_to_locations_map"); //Collection containing all the prices and locations in a format
    const collectionSavedSuburbResults = dbMongo.collection("autocompleted_location_suburbs"); //Collection of all the location matching will all their corresponding suburbs and other fetched infos
    //-------------
    const bodyParser = require("body-parser");
    app
      .get("/", function (req, res) {
        res.send("Pricing services up");
      })
      .use(bodyParser.json())
      .use(bodyParser.urlencoded({ extended: true }));

    //-------------------------------

    app.post("/getOverallPricingAndAvailabilityDetails", function (req, res) {
      resolveDate();
      //Test data
      let tmp = {
        user_fingerprint: "7c57cb6c9471fd33fd265d5441f253eced2a6307c0207dea57c987035b496e6e8dfa7105b86915da",
        connect_type: "ConnectUS",
        ride_mode: "RIDE", //Or DELIVERY
        passengers_number: 3,
        request_type: "immediate",
        pickup_time: 1605984208,
        country: "Namibia",
        pickup_location_infos: {
          pickup_type: "PrivateLocation",
          coordinates: { latitude: -22.522247, longitude: 17.058754 },
          location_name: "Maerua mall",
          street_name: "Andromeda Street",
          suburb: false,
          state: false,
          city: "Windhoek",
        },
        destination_location_infos: [
          {
            passenger_number_id: 1,
            dropoff_type: false,
            coordinates: { latitude: -22.522247, longitude: 17.058754 },
            location_name: "Location 1",
            street_name: "Street 1",
            suburb: false,
            state: false,
            city: "Windhoek",
          },
          {
            passenger_number_id: 2,
            dropoff_type: false,
            coordinates: { latitude: -22.576061, longitude: 17.044417 },
            location_name: "Location 2",
            street_name: "Street 2",
            suburb: false,
            state: false,
            city: "Windhoek",
          },
          {
            passenger_number_id: 3,
            dropoff_type: false,
            coordinates: { latitude: -22.578514, longitude: 17.099917 },
            location_name: "Location 3",
            street_name: "Street 3",
            suburb: false,
            state: false,
            city: "Windhoek",
          },
          {
            passenger_number_id: 4,
            dropoff_type: false,
            coordinates: { latitude: -22.589826, longitude: 17.083445 },
            location_name: "Location 4",
            street_name: "Street 4",
            suburb: false,
            state: false,
            city: "Windhoek",
          },
        ],
      };

      req = tmp;

      /*let params = urlParser.parse(req.url, true);
      req = params.query;
      console.log(req);*/

      if (checkInputIntegrity(req)) {
        console.log("Passenged the integrity test.");
        //Valid input
        //Autocomplete the input data
        new Promise((res) => {
          autocompleteInputData(res, req, collectionSavedSuburbResults);
        }).then(
          (result) => {
            if (result !== false) {
              let completeInput = result;
              console.log("Done autocompleting");
              //Generate prices metadata for all the relevant vehicles categories
              console.log("Computing prices metadata of relevant car categories");
              new Promise((res) => {
                estimateFullVehiclesCatPrices(res, completeInput, collectionVehiclesInfos, collectionPricesLocationsMap);
              }).then(
                (result) => {
                  console.log("DOne computing fares");
                  console.log(result);
                  res.send(result);
                },
                (error) => {
                  console.log(error);
                  res.send({ response: "Failed perform the operations" });
                }
              );
              //...
            } //Error - Failed input augmentation
            else {
              res.send({ response: "Failed input augmentation" });
            }
          },
          (error) => {
            //Error - Failed input augmentation
            console.log(error);
            res.send({ response: "Failed input augmentation" });
          }
        );
      } //Invalid input data
      else {
        res.send({ response: "Failed integrity" });
      }
    });
  });
});

server.listen(port);
