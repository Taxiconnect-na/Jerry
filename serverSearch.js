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

//INITIALIZE LOCATION CACHE
//Check if a checkpoint exists
function restoreSearchedLocations_cache(res, collectionMongoDb) {
  try {
    collectionMongoDb.find({}).toArray(function (err, cachedData) {
      //logger.info(cachedData);
      if (res.lenth == 0) {
        //Empty initialize
        logger.info("Initializing empty cache");
        //Initialize location cache - redis
        redisCluster.set("search_locations", JSON.stringify([]));
        res(true);
      } //Not empty restore - redis
      else {
        logger.info("Restoring location cache");
        redisCluster.set("search_locations", JSON.stringify(cachedData));
        res(true);
      }
    });
  } catch (err) {
    logger.info(err);
    //Initialize location cache - redis
    redisCluster.set("search_locations", JSON.stringify([]));
    res(true);
  }
}

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
 * @param {*} queryOR
 * @param {*} city
 * @param {*} bbox
 * @param {*} res
 * @param {*} timestamp
 * @param {*} collectionMongoDb
 * @param {*} keyREDIS
 */

function newLoaction_search_engine(
  queryOR,
  city,
  bbox,
  res,
  timestamp,
  collectionMongoDb,
  keyREDIS
) {
  //..
  query = encodeURIComponent(queryOR.toLowerCase().trim());
  let urlRequest =
    process.env.URL_SEARCH_SERVICES +
    "api?q=" +
    query +
    "&bbox=" +
    bbox +
    "&limit=" +
    _LIMIT_LOCATION_SEARCH_RESULTS;
  requestAPI(urlRequest, function (err, response, body) {
    try {
      body = JSON.parse(body);

      if (body != undefined) {
        if (
          body.features[0] !== undefined &&
          body.features[0].properties != undefined
        ) {
          //logObject(body);
          //...
          if (body.features.length > 0) {
            var locationsSelected = []; //Will contain the first gathering of results - raw from search
            //.
            let request0 = body.features.map((locationPlace) => {
              return new Promise((resolve) => {
                let averageGeo = null;
                if (locationPlace.properties.extent == undefined) {
                  //Consider point to find the averge geo
                  averageGeo = locationPlace.geometry.coordinates.reduce(
                    (a, b) => a + b,
                    0
                  );
                } //Average geo from extent
                else {
                  averageGeo = locationPlace.properties.extent.reduce(
                    (a, b) => a + b,
                    0
                  );
                }

                if (locationPlace.properties.street == undefined) {
                  locationPlace.properties.street = false;
                }
                if (locationPlace.properties.name == undefined) {
                  locationPlace.properties.name = false;
                }
                //...
                let littlePack = {
                  location_id: locationPlace.properties.osm_id,
                  location_name: locationPlace.properties.name,
                  coordinates: locationPlace.geometry.coordinates,
                  averageGeo: averageGeo,
                  city: locationPlace.properties.city,
                  street: locationPlace.properties.street,
                  state: locationPlace.properties.state,
                  country: locationPlace.properties.country,
                  query: queryOR,
                };
                //logObject(littlePack);
                resolve(littlePack);
              });
            });
            //Done with grathering result of brute API search
            Promise.all(request0).then((val) => {
              //logger.info(val);
              //Remove all the false values
              val = fastFilter(val, function (element) {
                return element !== false;
              });
              //...
              //logObject(val);
              let request1 = new Promise((resolve) => {
                similarityCheck_locations_search(val, queryOR, resolve);
              }).then(
                (result) => {
                  //logObject(result);
                  //Remove the false
                  result = fastFilter(result, function (element) {
                    return element !== false;
                  });

                  if (result.length > 0) {
                    //populated
                    //Update search cache - redis
                    redisGet(keyREDIS).then(
                      (resp) => {
                        //logger.info(resp);
                        if (resp !== null) {
                          let respPrevRedisCache = JSON.parse(resp);
                          //logObject(respPrevRedisCache);
                          respPrevRedisCache = respPrevRedisCache.map(
                            JSON.stringify
                          );
                          //logObject(respPrevRedisCache);
                          let newSearchRecords = [];
                          //...
                          let request2 = new Promise((resolve) => {
                            result.map((item) => {
                              //New record
                              respPrevRedisCache.push(JSON.stringify(item));
                              newSearchRecords.push(item);
                            });
                            //Remove duplicates from new search
                            newSearchRecords = [...new Set(newSearchRecords)];
                            resolve(newSearchRecords);
                          }).then(
                            (reslt) => {
                              //Update cache
                              //let cachedString = JSON.stringify(respPrevRedisCache);
                              let cachedString = JSON.stringify(
                                respPrevRedisCache.map(JSON.parse)
                              );
                              //logObject(newSearchRecords);
                              if (newSearchRecords.length > 0) {
                                new Promise((resUpdate) => {
                                  collectionMongoDb.insertMany(
                                    newSearchRecords,
                                    function (err, res) {
                                      logger.info(res);
                                      resUpdate(
                                        "Updated mongo with new search results from autocomplete"
                                      );
                                    }
                                  );
                                }).then(
                                  () => {},
                                  () => {}
                                );
                              }
                              //Update redis local cache
                              redisCluster.setex(
                                keyREDIS,
                                process.env.REDIS_EXPIRATION_5MIN * 16,
                                cachedString
                              );
                              //Update mongodb - cache
                              res({
                                search_timestamp: timestamp,
                                result: {
                                  search_timestamp: timestamp,
                                  result: removeResults_duplicates(
                                    result
                                  ).slice(0, 5),
                                },
                              });
                            },
                            (err) => {
                              res({
                                search_timestamp: timestamp,
                                result: removeResults_duplicates(result).slice(
                                  0,
                                  5
                                ),
                              });
                            }
                          );
                        } else {
                          logger.info("setting redis");
                          //set redis
                          redisCluster.setex(
                            keyREDIS,
                            process.env.REDIS_EXPIRATION_5MIN * 16,
                            JSON.stringify(result)
                          );
                          res({
                            search_timestamp: timestamp,
                            result: removeResults_duplicates(result).slice(
                              0,
                              5
                            ),
                          });
                        }
                      },
                      (error) => {
                        logger.info(error);
                        res({
                          search_timestamp: timestamp,
                          result: removeResults_duplicates(result).slice(0, 5),
                        });
                      }
                    );
                  } //empty
                  else {
                    res(false);
                  }
                },
                (error) => {
                  logger.info(error);
                  res(false);
                }
              );
            });
          } //No results
          else {
            res(false);
          }
        } else {
          res(false);
        }
      } else {
        res(false);
      }
    } catch (error) {
      logger.info(error);
      res(false);
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
 * @param {*} collectionMongoDb
 */

function getLocationList_five(
  queryOR,
  city,
  country,
  bbox,
  res,
  timestamp,
  collectionMongoDb
) {
  logger.info(city, country);
  //Check if cached results are available
  let keyREDIS =
    "search_locations-" +
    city.trim().toLowerCase() +
    "-" +
    country.trim().toLowerCase();
  //-------------------------------------
  redisGet(keyREDIS).then(
    (reslt) => {
      if (reslt != null && reslt !== undefined) {
        //logObject(JSON.parse(reslt));
        var cachedLocations = JSON.parse(reslt);
        //sort based on the keyword, city and country names
        cachedLocations = cachedLocations.filter((element) => {
          if (
            element.country != undefined &&
            element.city != undefined &&
            element.query != undefined
          ) {
            let regCheckerQuery = new RegExp(
              escapeStringRegexp(queryOR.toLowerCase().trim()),
              "i"
            );
            return (
              regCheckerQuery.test(element.query) &&
              element.country.toLowerCase().trim() ==
                country.toLowerCase().trim() &&
              element.city.toLowerCase().trim() == city.toLowerCase().trim()
            );
          } //Invalid element
          else {
            return false;
          }
        });
        //...Check tolerance number
        if (cachedLocations.length > 0) {
          //Exists
          logger.info("Cached data fetch");
          //logObject(removeResults_duplicates(cachedLocations));
          res({
            search_timestamp: timestamp,
            result: {
              search_timestamp: timestamp,
              result: removeResults_duplicates(cachedLocations).slice(0, 5),
            },
          });
        } //No results launch new search
        else {
          logger.info("Launch new search");
          newLoaction_search_engine(
            queryOR,
            city,
            bbox,
            res,
            timestamp,
            collectionMongoDb,
            keyREDIS
          );
        }
      } //No cached results
      else {
        //Launch new search
        logger.info("Launch new search");
        newLoaction_search_engine(
          queryOR,
          city,
          bbox,
          res,
          timestamp,
          collectionMongoDb,
          keyREDIS
        );
      }
    },
    (error) => {
      //Launch new search
      logger.info(error);
      logger.info("Launch new search");
      newLoaction_search_engine(
        queryOR,
        city,
        bbox,
        res,
        timestamp,
        collectionMongoDb,
        keyREDIS
      );
    }
  );
}
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
          const collectionMongoDb = dbMongo.collection(
            "searched_locations_persist"
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
            logger.info(request);
            let request0 = null;
            //Update search timestamp
            //search_timestamp = dateObject.unix();
            let search_timestamp = request.query.length;
            //1. Get the bbox
            request0 = new Promise((res, rej) => {
              getCityBbox(request.city, res);
            }).then(
              (result) => {
                let bbox = result;
                //Get the location
                new Promise((res, rej) => {
                  let tmpTimestamp = search_timestamp;
                  //Replace wanaheda by Samora Machel Constituency
                  request.query = /(wanaheda|wanahe|wanahed)/i.test(
                    request.query
                  )
                    ? "Samora Machel Constituency"
                    : request.query;
                  //...
                  getLocationList_five(
                    request.query,
                    request.city,
                    request.country,
                    bbox,
                    res,
                    tmpTimestamp,
                    collectionMongoDb
                  );
                }).then(
                  (result) => {
                    logger.info(result);
                    if (
                      parseInt(search_timestamp) !=
                      parseInt(result.search_timestamp)
                    ) {
                      //Inconsistent - do not update
                      //logger.info('Inconsistent');
                      //res.send(false);
                      res.send(result);
                    } //Consistent - update
                    else {
                      //logger.info('Consistent');
                      //logObject(result);
                      //socket.emit("getLocations-response", result);
                      res.send(result);
                    }
                  },
                  (error) => {
                    logger.info(error);
                    //socket.emit("getLocations-response", false);
                    res.send(false);
                  }
                );
              },
              (error) => {
                logger.info(error);
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
