require("dotenv").config();
//require("newrelic");
var express = require("express");
const http = require("http");
const fs = require("fs");
const MongoClient = require("mongodb").MongoClient;
const certFile = fs.readFileSync("./rds-combined-ca-bundle.pem");

const { logger } = require("./LogService");

var app = express();
var server = http.createServer(app);
const requestAPI = require("request");
//---center
const { promisify, inspect } = require("util");
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
//....
var fastFilter = require("fast-filter");
const escapeStringRegexp = require("escape-string-regexp");
const urlParser = require("url");
const moment = require("moment");

const cities_bbox = {
  windhoek: "16.65390,-22.41103,17.46414,-22.69829",
};

//GLOBALS
const _CITY = "Windhoek";
const _COUNTRY = "Namibia";
const _MINIMAL_SEARCH_CACHED_RESULTS_TOLERANCE = 5; //Cached result for search must have at least X results, otherwise launch a new search
const _LIMIT_LOCATION_SEARCH_RESULTS = 50; //Limit of the search result from the MAP API

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

function logObject(obj) {
  logger.info(
    inspect(obj, {
      maxArrayLength: null,
      depth: null,
      showHidden: true,
      colors: true,
    })
  );
}

function getCityBbox(city, res) {
  city = city.toLowerCase().trim();
  let bbox = cities_bbox[city];
  res(bbox);
}

checkName = (name, str) => {
  var pattern = str
    .split("")
    .map((x) => {
      return `(?=.*${x})`;
    })
    .join("");
  var regex = new RegExp(`${pattern}`, "g");
  return name.match(regex);
};

function similarityCheck_locations_search(arrayLocations, query, res) {
  //logObject(arrayLocations);
  if (arrayLocations.length > 0) {
    arrayLocations = fastFilter(arrayLocations, function (element) {
      if (
        element.location_name != undefined &&
        element.location_name != false
      ) {
        return (
          element.location_name
            .toLowerCase()
            .includes(query.toLowerCase().trim()) ||
          checkName(element.location_name.toLowerCase(), query.toLowerCase())
        );
      } else {
        return false;
      }
    });
    //..
    logger.info(arrayLocations);
    if (arrayLocations.length > 0) {
      res(arrayLocations.sort());
    } //Empty
    else {
      res(false);
    }
  } else {
    res(false);
  }
}

/**
 * @func newLoaction_search_engine
 * Responsible for performing new location seearches based on some specific keywords.
 * @param {*} keyREDIS: to save the global final result for 2 days
 * @param {*} queryOR
 * @param {*} city
 * @param {*} bbox
 * @param {*} res
 * @param {*} timestamp
 */

function newLoaction_search_engine(
  keyREDIS,
  queryOR,
  city,
  bbox,
  res,
  timestamp
) {
  //? 1. Check if it was written in mongodb
  collectionSearchedLocationPersist
    .find({ query: queryOR, city: city })
    .toArray(function (err, searchedData) {
      if (err) {
        logger.error(err);
        //Fresh search
        new Promise((resCompute) => {
          initializeFreshGetOfLocations(
            keyREDIS,
            queryOR,
            city,
            bbox,
            resCompute,
            timestamp
          );
        })
          .then((result) => {
            res(result);
          })
          .catch((error) => {
            logger.error(error);
            res(false);
          });
      }
      //...
      if (
        searchedData !== undefined &&
        searchedData !== null &&
        searchedData.length > 0
      ) {
        logger.warn("FOUND SOME MONGODB RECORDS");
        logger.info(searchedData);
        //TODO: could twik this value to allow a minimum limit of values
        let finalSearchResults = {
          search_timestamp: timestamp,
          result: removeResults_duplicates(searchedData).slice(0, 5),
        };
        //! Cache globally the final result
        new Promise((resCache) => {
          redisCluster.setex(
            keyREDIS,
            parseFloat(process.env.REDIS_EXPIRATION_5MIN) * 24,
            JSON.stringify(finalSearchResults)
          );
          resCache(true);
        })
          .then()
          .catch();
        //...DONE
        res(finalSearchResults);
      } //Fresh search
      else {
        logger.warn("NO MONG RECORDS< MAKE A FRESH SEARCH");
        new Promise((resCompute) => {
          initializeFreshGetOfLocations(
            keyREDIS,
            queryOR,
            city,
            bbox,
            resCompute,
            timestamp
          );
        })
          .then((result) => {
            res(result);
          })
          .catch((error) => {
            logger.error(error);
            res(false);
          });
      }
    });
}

/**
 * @func initializeFreshGetOfLocations
 * Responsible for launching the request for fresh locations from Google
 * @param {*} keyREDIS: to save the global final result for 2 days
 * @param {*} queryOR
 * @param {*} city
 * @param {*} bbox
 * @param {*} res
 * @param {*} timestamp
 */
function initializeFreshGetOfLocations(
  keyREDIS,
  queryOR,
  city,
  bbox,
  res,
  timestamp
) {
  query = encodeURIComponent(queryOR.toLowerCase());

  //TODO: could allocate the country dynamically for scale.
  let urlRequest = `https://maps.googleapis.com/maps/api/place/autocomplete/json?input=${query}&key=${process.env.GOOGLE_API_KEY}&components=country:na&language=en`;

  requestAPI(urlRequest, function (err, response, body) {
    try {
      body = JSON.parse(body);

      if (body != undefined) {
        if (
          body.predictions !== undefined &&
          body.predictions !== null &&
          body.predictions.length > 0
        ) {
          //...
          //.
          let request0 = body.predictions.map((locationPlace, index) => {
            return new Promise((resolve) => {
              let averageGeo = 0;
              //? Deduct the street, city and country
              let locationName = locationPlace.structured_formatting.main_text;
              //Get the street city and country infos
              let secondaryDetailsCombo =
                locationPlace.structured_formatting.secondary_text !==
                  undefined &&
                locationPlace.structured_formatting.secondary_text !== null
                  ? locationPlace.structured_formatting.secondary_text.split(
                      ", "
                    )
                  : false; //Will contain the street, city and country respectively
              let streetName =
                secondaryDetailsCombo !== false
                  ? secondaryDetailsCombo.length >= 3
                    ? secondaryDetailsCombo[secondaryDetailsCombo.length - 3]
                    : false
                  : false;
              //city
              let cityName =
                secondaryDetailsCombo !== false
                  ? secondaryDetailsCombo.length >= 2
                    ? secondaryDetailsCombo[secondaryDetailsCombo.length - 2]
                    : false
                  : false;
              //Country
              let countryName =
                secondaryDetailsCombo !== false
                  ? secondaryDetailsCombo.length >= 1
                    ? secondaryDetailsCombo[secondaryDetailsCombo.length - 1]
                    : false
                  : false;

              //...
              let littlePack = {
                indexSearch: index,
                location_id: locationPlace.place_id,
                location_name: locationName,
                coordinates: null, //To be completed!
                averageGeo: averageGeo,
                city: cityName,
                street: streetName,
                state: null, //To be completed!
                country: countryName,
                query: queryOR,
              };
              //! Get the coordinates and save them in mongodb - to save on cost
              new Promise((resCompute) => {
                attachCoordinatesAndRegion(littlePack, resCompute);
              })
                .then((result) => {
                  resolve(result);
                })
                .catch((error) => {
                  logger.error(error);
                  resolve(false);
                });
            });
          });
          //Done with grathering result of brute API search
          Promise.all(request0).then((val) => {
            //logger.info(val);
            //Remove all the false values
            let result = fastFilter(val, function (element) {
              return element !== false && element !== null;
            });
            //? Remove all the out of context cities
            result = fastFilter(val, function (element) {
              let regFilterCity = new RegExp(city.trim(), "i");
              return element.city !== false && element.city !== undefined
                ? regFilterCity.test(element.city.trim())
                : false;
            });
            //! Save in mongo search persist - Cost reduction
            new Promise((saveMongo) => {
              if (result.length > 0) {
                collectionSearchedLocationPersist.insertMany(
                  result,
                  function (err, reslt) {
                    saveMongo(true);
                    logger.warn("SAVED IN MONGO PERSIST!");
                  }
                );
              } //Nothing to save
              else {
                saveMongo(false);
              }
            })
              .then()
              .catch();
            //...
            if (result.length > 0) {
              let finalSearchResults = {
                search_timestamp: timestamp,
                result: removeResults_duplicates(result).slice(0, 5),
              };
              //populated
              res(finalSearchResults);
            } //empty
            else {
              res(false);
            }
          });
        } else {
          res(false);
        }
      } else {
        res(false);
      }
    } catch (error) {
      logger.warn("HERE5");
      logger.warn(error);
      res(false);
      // initializeFreshGetOfLocations(
      //   keyREDIS,
      //   queryOR,
      //   city,
      //   bbox,
      //   res,
      //   timestamp
      // );
    }
  });
}

/**
 * @func arrangeAndExtractSuburbAndStateOrMore
 * Responsible for handling the complex regex and operations of getting the state and suburb
 * from a raw google response and returning a dico of the wanted values.
 * @param body: a copy of the google response.
 * @param location_name: for suburbs exception
 */
function arrangeAndExtractSuburbAndStateOrMore(body, location_name) {
  //Coords
  let coordinates = [
    body.result.geometry.location.lat,
    body.result.geometry.location.lng,
  ];
  //State
  let state =
    body.result.address_components.filter((item) =>
      item.types.includes("administrative_area_level_1")
    )[0] !== undefined &&
    body.result.address_components.filter((item) =>
      item.types.includes("administrative_area_level_1")
    )[0] !== null
      ? body.result.address_components
          .filter((item) =>
            item.types.includes("administrative_area_level_1")
          )[0]
          .short_name.replace(" Region", "")
      : false;
  //Suburb
  let suburb =
    body.result.address_components.filter((item) =>
      item.types.includes("sublocality_level_1", "political")
    )[0] !== undefined &&
    body.result.address_components.filter((item) =>
      item.types.includes("sublocality_level_1", "political")
    )[0] !== null
      ? body.result.address_components
          .filter((item) =>
            item.types.includes("sublocality_level_1", "political")
          )[0]
          .short_name.trim()
      : false;

  //! Add /CBD for Windhoek Central suburb
  suburb =
    suburb !== false &&
    suburb !== undefined &&
    /^Windhoek Central$/i.test(suburb)
      ? `${suburb} / CBD`
      : suburb;

  //!EXCEPTIONS SUBURBS
  //! 1. Make suburb Elisenheim if anything related to it (Eg. location_name)
  suburb = /Elisenheim/i.test(location_name) ? "Elisenheim" : suburb;
  //! 2. Make suburb Ausspannplatz if anything related to it
  suburb = /Ausspannplatz/i.test(location_name) ? "Ausspannplatz" : suburb;
  //DONE
  return {
    coordinates: coordinates,
    state: state,
    suburb: suburb,
  };
}

/**
 * @func attachCoordinatesAndRegion
 * Responsible as the name indicates of addiing the coordinates of the location and the region.
 * @param littlePack: the incomplete location to complete
 * @param resolve
 */
function attachCoordinatesAndRegion(littlePack, resolve) {
  //? Check if its wasn't cached before
  let redisKey = `${littlePack.location_id}-coordinatesAndRegion`;
  redisGet(redisKey).then((resp) => {
    if (resp !== null) {
      try {
        logger.warn("Using cached coordinates and region");
        resp = JSON.parse(resp);
        //? Quickly complete
        body = resp;
        //Has a previous record
        let refinedExtractions = arrangeAndExtractSuburbAndStateOrMore(
          body,
          littlePack.location_name
        );
        let coordinates = refinedExtractions.coordinates;
        let state = refinedExtractions.state;
        let suburb = refinedExtractions.suburb;
        //...
        littlePack.coordinates = coordinates;
        littlePack.state = state;
        littlePack.suburb = suburb;
        //...done
        resolve(littlePack);
      } catch (error) {
        logger.warn("HERE2");
        logger.warn(error);
        //Do a fresh search or from mongo
        new Promise((resCompute) => {
          doFreshGoogleSearchAndReturn(littlePack, redisKey, resCompute);
        })
          .then((result) => {
            resolve(result);
          })
          .catch((error) => {
            logger.error(error);
            resolve(false);
          });
      }
    } //Not cached - check Mongo
    else {
      //? First check in mongo
      collectionSearchedLocationPersist
        .find({ "result.place_id": littlePack.location_id })
        .toArray(function (err, placeInfo) {
          if (err) {
            logger.error(err);
            //fresh
            new Promise((resCompute) => {
              doFreshGoogleSearchAndReturn(littlePack, redisKey, resCompute);
            })
              .then((result) => {
                resolve(result);
              })
              .catch((error) => {
                logger.error(error);
                resolve(false);
              });
          }
          //...
          if (
            placeInfo !== undefined &&
            placeInfo !== null &&
            placeInfo.length > 0
          ) {
            body = placeInfo[0];
            //Has a previous record
            let refinedExtractions = arrangeAndExtractSuburbAndStateOrMore(
              body,
              littlePack.location_name
            );
            let coordinates = refinedExtractions.coordinates;
            let state = refinedExtractions.state;
            let suburb = refinedExtractions.suburb;
            //...
            littlePack.coordinates = coordinates;
            littlePack.state = state;
            littlePack.suburb = suburb;
            //..Save the body in mongo
            body["date_updated"] = new Date(chaineDateUTC);
            new Promise((resSave) => {
              collectionAutoCompletedSuburbs.updateOne(
                { "result.place_id": littlePack.place_id },
                {
                  $set: body,
                },
                { upsert: true },
                function (err, res) {
                  logger.error(err);
                  resSave(true);
                }
              );
            })
              .then()
              .catch();
            //...Cache it
            new Promise((resCache) => {
              redisCluster.setex(
                redisKey,
                parseFloat(process.env.REDIS_EXPIRATION_5MIN) * 24,
                JSON.stringify(body)
              );
              resCache(true);
            });
            //...done
            resolve(littlePack);
          } //No previous mongo record - do fresh
          else {
            new Promise((resCompute) => {
              doFreshGoogleSearchAndReturn(littlePack, redisKey, resCompute);
            })
              .then((result) => {
                resolve(result);
              })
              .catch((error) => {
                logger.error(error);
                resolve(false);
              });
          }
        });
    }
  });
}

/**
 * @func doFreshGoogleSearchAndReturn
 * Responsible for doing a clean google maps search, save the value in mongo, cache it and return an updated object.
 */
function doFreshGoogleSearchAndReturn(littlePack, redisKey, resolve) {
  let urlRequest = `https://maps.googleapis.com/maps/api/place/details/json?placeid=${littlePack.location_id}&key=${process.env.GOOGLE_API_KEY}&fields=formatted_address,address_components,geometry,place_id&language=en`;

  requestAPI(urlRequest, function (err, response, body) {
    try {
      body = JSON.parse(body);
      if (
        body.result !== undefined &&
        body.result.address_components !== undefined &&
        body.result.geometry !== undefined
      ) {
        let refinedExtractions = arrangeAndExtractSuburbAndStateOrMore(
          body,
          littlePack.location_name
        );
        let coordinates = refinedExtractions.coordinates;
        let state = refinedExtractions.state;
        let suburb = refinedExtractions.suburb;
        //...
        littlePack.coordinates = coordinates;
        littlePack.state = state;
        littlePack.suburb = suburb;
        //..Save the body in mongo
        body["date_updated"] = new Date(chaineDateUTC);
        new Promise((resSave) => {
          collectionAutoCompletedSuburbs.updateOne(
            { "result.place_id": littlePack.place_id },
            { $set: body },
            { upsert: true },
            function (err, res) {
              logger.error(err);
              resSave(true);
            }
          );
        })
          .then()
          .catch();
        //...Cache it
        new Promise((resCache) => {
          redisCluster.setex(
            redisKey,
            parseFloat(process.env.REDIS_EXPIRATION_5MIN) * 24,
            JSON.stringify(body)
          );
          resCache(true);
        });
        //...done
        resolve(littlePack);
      } //Invalid data
      else {
        resolve(false);
      }
    } catch (error) {
      logger.warn("HERE3");
      logger.warn(error);
      resolve(false);
      //doFreshGoogleSearchAndReturn(littlePack, redisKey, resolve);
    }
  });
}

function removeResults_duplicates(arrayResults, resolve) {
  //logger.info(arrayResults);
  let arrayResultsClean = [];
  let arrayIds = [];
  arrayResults.map((location) => {
    let tmpId =
      location.location_name +
      " " +
      location.city +
      " " +
      location.street +
      " " +
      location.country;
    if (!arrayIds.includes(tmpId)) {
      //New location
      arrayIds.push(tmpId);
      arrayResultsClean.push(location);
    }
  });
  return arrayResultsClean;
}

/**
 * @func getLocationList_five
 * Responsible for getting the list of the 5 most accurate locations based on some keywords.
 * It should consider the city and country from where the search was made.
 * @param {*} queryOR
 * @param {*} city
 * @param {*} country
 * @param {*} bbox
 * @param {*} res
 * @param {*} timestamp
 */

function getLocationList_five(queryOR, city, country, bbox, res, timestamp) {
  resolveDate();
  //Check if cached results are available
  let keyREDIS = `search_locations-${city.trim().toLowerCase()}-${country
    .trim()
    .toLowerCase()}-${queryOR}`; //! Added time for debug
  //-------------------------------------
  redisGet(keyREDIS).then(
    (resp) => {
      if (resp != null && resp !== undefined) {
        logger.warn("Found global search results for the same query input");
        //logObject(JSON.parse(reslt));
        try {
          //Rehydrate records
          new Promise((resCompute) => {
            newLoaction_search_engine(
              keyREDIS,
              queryOR,
              city,
              bbox,
              resCompute,
              timestamp
            );
          })
            .then()
            .catch();
          //...
          logger.error(resp);
          resp = JSON.parse(resp);
          //!Update search record time
          resp.search_timestamp = timestamp;
          res(resp);
        } catch (error) {
          logger.warn("HERE");
          logger.warn(error);
          logger.info("Launch new search");
          newLoaction_search_engine(
            keyREDIS,
            queryOR,
            city,
            bbox,
            res,
            timestamp
          );
        }
      } //No cached results
      else {
        //Launch new search
        logger.info("Launch new search");
        newLoaction_search_engine(
          keyREDIS,
          queryOR,
          city,
          bbox,
          res,
          timestamp
        );
      }
    },
    (error) => {
      //Launch new search
      logger.warn(error);
      logger.info("Launch new search");
      newLoaction_search_engine(keyREDIS, queryOR, city, bbox, res, timestamp);
    }
  );
}

var collectionSearchedLocationPersist = null;
var collectionAutoCompletedSuburbs = null;

redisCluster.on("connect", function () {
  logger.info("[*] Redis connected");
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
      process.env.GOOGLE_API_KEY = body.GOOGLE_API_KEY; //?Could be dev or prod depending on process.env.ENVIRONMENT

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
          logger.info("Connected to Mongodb");
          const dbMongo = clientMongo.db(process.env.DB_NAME_MONGODDB);
          collectionSearchedLocationPersist = dbMongo.collection(
            "searched_locations_persist"
          );
          collectionAutoCompletedSuburbs = dbMongo.collection(
            "autocompleted_location_suburbs"
          );
          //-------------
          //Cached restore OR initialized
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
            );

          //1. SEARCH API
          app.get("/getSearchedLocations", function (request, res) {
            resolveDate();
            //..
            let params = urlParser.parse(request.url, true);
            request = params.query;
            // logger.info(request);
            //Update search timestamp
            //search_timestamp = dateObject.unix();
            // let search_timestamp = request.query.length;
            let search_timestamp = new Date(chaineDateUTC).getTime();
            let redisKeyConsistencyKeeper = `${request.user_fp}-autocompleteSearchRecordTime`;
            //1. Get the bbox
            request0 = new Promise((res) => {
              //Save in Cache
              redisCluster.set(redisKeyConsistencyKeeper, request.query);
              getCityBbox(request.city, res);
            }).then(
              (result) => {
                let bbox = result;
                //Get the location
                new Promise((res) => {
                  let tmpTimestamp = search_timestamp;
                  getLocationList_five(
                    request.query,
                    request.city,
                    request.country,
                    bbox,
                    res,
                    tmpTimestamp
                  );
                }).then(
                  (result) => {
                    //? Get the redis record time and compare
                    redisGet(redisKeyConsistencyKeeper)
                      .then((resp) => {
                        if (
                          resp !== null &&
                          result !== false &&
                          result.result !== undefined &&
                          result.result[0].query !== undefined
                        ) {
                          logger.warn(`Redis last time record: ${resp}`);
                          logger.warn(
                            `Request time record: ${result.result[0].query}`
                          );
                          logger.warn(
                            `Are search results consistent ? --> ${
                              resp === result.result[0].query
                            }`
                          );
                          if (resp === result.result[0].query) {
                            logger.warn(result);
                            //Inconsistent - do not update
                            logger.info("Consistent");
                            //res.send(false);
                            res.send({ result: result });
                          } //Consistent - update
                          else {
                            logger.info("Inconsistent");
                            //logObject(result);
                            // res.send({ result: result });
                            res.send(false);
                          }
                        } //Nothing the compare to
                        else {
                          res.send(false);
                        }
                      })
                      .catch((error) => {
                        logger.error(error);
                        res.send(false);
                      });
                  },
                  (error) => {
                    logger.warn("HERE10");
                    logger.warn(error);
                    res.send(false);
                  }
                );
              },
              (error) => {
                logger.warn(error);
                //socket.emit("getLocations-response", false);
                res.send(false);
              }
            );
          });
        }
      );
    }
  );
});

server.listen(process.env.SEARCH_SERVICE_PORT);
//dash.monitor({server: server});
