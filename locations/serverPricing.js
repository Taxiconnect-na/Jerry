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
  console.log(pickupInfos.coordinates);
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
          console.log(pickupInfos);
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
                pickupInfos = result; //Update shortcut var
                inputData.pickup_location_infos = result; //Update main object
                //...Done auto complete destination locations
                console.log(result);
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
              pickupInfos = result; //Update shortcut var
              inputData.pickup_location_infos = result; //Update main object
              //...Done auto complete destination locations
              console.log(result);
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
            pickupInfos = result; //Update shortcut var
            inputData.pickup_location_infos = result; //Update main object
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
        //console.log(result);
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
        });
        //..
        Promise.all(promiseParent2).then(
          (result) => {
            console.log(result);
            result.map((location) => {
              if (location.passenger_number_id !== undefined) {
                //Linked to a user
                destinationLocations[location.passenger_number_id - 1].dropoff_type = location.locationType;
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
    const collectionNamibiaPricesLocationsMapWindhoek = dbMongo.collection("namibia_prices_to_locations_map_windoek"); //Collection containing all the prices and locations in a format specific to Namibia (Windhoek)
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
        connect_type: "ConnectMe",
        passengers_number: 1,
        request_type: "immediate",
        pickup_time: 1605984208,
        country: "Namibia",
        pickup_location_infos: {
          pickup_type: "PrivateLocation",
          coordinates: { latitude: -22.56962, longitude: 17.08335 },
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
            coordinates: { latitude: -22.593295, longitude: 17.066033 },
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
              console.log(result);
              let completeInput = result;
              console.log("Done autocompleting");
              res.send(completeInput);
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
