//var dash = require('appmetrics-dash');
var express = require("express");
const http = require("http");
const fs = require("fs");
const MongoClient = require("mongodb").MongoClient;

var app = express();
var server = http.createServer(app);
const mysql = require("mysql");
const requestAPI = require("request");
//---center
const { promisify, inspect } = require("util");
const redis = require("redis");
const client = redis.createClient();
const redisGet = promisify(client.get).bind(client);
//....
var fastFilter = require("fast-filter");
const urlParser = require("url");
var chaineDateUTC = null;
var dateObject = null;
const moment = require("moment");

const URL_SEARCH_SERVICES = "http://www.taxiconnectna.com:7007/";
const URL_MONGODB = "mongodb://localhost:27017";
const DB_NAME_MONGODB = "searched_locations_persist";

const clientMongo = new MongoClient(URL_MONGODB, { useUnifiedTopology: true });

//INITIALIZE LOCATION CACHE
//Check if a checkpoint exists
function restoreSearchedLocations_cache(res, collectionMongoDb) {
  try {
    collectionMongoDb.find({}).toArray(function (err, cachedData) {
      //console.log(cachedData);
      if (res.lenth == 0) {
        //Empty initialize
        console.log("Initializing empty cache");
        //Initialize location cache - redis
        client.set("search_locations", JSON.stringify([]), redis.print);
        res(true);
      } //Not empty restore - redis
      else {
        console.log("Restoring location cache");
        client.set("search_locations", JSON.stringify(cachedData), redis.print);
        res(true);
      }
    });
  } catch (err) {
    console.log(err);
    //Initialize location cache - redis
    client.set("search_locations", JSON.stringify([]), redis.print);
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
  date = date.year() + "-" + (date.month() + 1) + "-" + date.date() + " " + date.hour() + ":" + date.minute() + ":" + date.second();
  chaineDateUTC = date;
}
resolveDate();

const port = 7005;

//Database connection
const dbPool = mysql.createPool({
  connectionLimit: 1000000000,
  host: "localhost",
  database: "taxiconnect",
  user: "root",
  password: "",
});

function logObject(obj) {
  console.log(inspect(obj, { maxArrayLength: null, depth: null, showHidden: true, colors: true }));
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
      if (element.location_name != undefined && element.location_name != false) {
        return (
          element.location_name.toLowerCase().includes(query.toLowerCase().trim()) ||
          checkName(element.location_name.toLowerCase(), query.toLowerCase())
        );
      } else {
        return false;
      }
    });
    //..
    console.log(arrayLocations);
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

function newLoaction_search_engine(queryOR, bbox, res, timestamp, collectionMongoDb) {
  query = encodeURIComponent(queryOR.toLowerCase().trim());
  let urlRequest = URL_SEARCH_SERVICES + "api?q=" + query + "&bbox=" + bbox + "&limit=" + _LIMIT_LOCATION_SEARCH_RESULTS;
  requestAPI(urlRequest, function (err, response, body) {
    try {
      body = JSON.parse(body);

      if (body != undefined) {
        if (body.features[0].properties != undefined) {
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
                  averageGeo = locationPlace.geometry.coordinates.reduce((a, b) => a + b, 0);
                } //Average geo from extent
                else {
                  averageGeo = locationPlace.properties.extent.reduce((a, b) => a + b, 0);
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
              //console.log(val);
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
                    redisGet("search_locations").then(
                      (resp) => {
                        let respPrevRedisCache = JSON.parse(resp);
                        //logObject(respPrevRedisCache);
                        respPrevRedisCache = respPrevRedisCache.map(JSON.stringify);
                        //logObject(respPrevRedisCache);
                        let newSearchRecords = [];
                        //...
                        let request2 = new Promise((resolve) => {
                          result.map((item) => {
                            if (!respPrevRedisCache.includes(JSON.stringify(item))) {
                              //New record
                              respPrevRedisCache.push(JSON.stringify(item));
                              newSearchRecords.push(item);
                              resolve("success");
                            } else {
                              resolve("already_existing_record");
                            }
                          });
                        }).then(
                          (reslt) => {
                            //Update cache
                            //let cachedString = JSON.stringify(respPrevRedisCache);
                            let cachedString = JSON.stringify(respPrevRedisCache.map(JSON.parse));
                            //logObject(newSearchRecords);
                            if (newSearchRecords.length > 0) {
                              collectionMongoDb.insertMany(newSearchRecords, function (err, res) {
                                console.log(res);
                              });
                            }
                            //Update redis local cache
                            client.set("search_locations", cachedString, redis.print);
                            //Update mongodb - cache
                            res({
                              search_timestamp: timestamp,
                              result: { search_timestamp: timestamp, result: removeResults_duplicates(result).slice(0, 5) },
                            });
                          },
                          (err) => {
                            res({ search_timestamp: timestamp, result: removeResults_duplicates(result).slice(0, 5) });
                          }
                        );
                      },
                      (error) => {
                        console.log(error);
                        res({ search_timestamp: timestamp, result: removeResults_duplicates(result).slice(0, 5) });
                      }
                    );
                  } //empty
                  else {
                    res(false);
                  }
                },
                (error) => {
                  console.log(error);
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
      res(false);
    }
  });
}

function removeResults_duplicates(arrayResults, resolve) {
  //console.log(arrayResults);
  let arrayResultsClean = [];
  let arrayIds = [];
  arrayResults.map((location) => {
    let tmpId = location.location_name + " " + location.city + " " + location.street + " " + location.country;
    if (!arrayIds.includes(tmpId)) {
      //New location
      arrayIds.push(tmpId);
      arrayResultsClean.push(location);
    }
  });
  return arrayResultsClean;
}

function getLocationList_five(queryOR, bbox, res, timestamp, collectionMongoDb) {
  //Check if cached results are available
  redisGet("search_locations").then(
    (reslt) => {
      if (reslt != null && reslt !== undefined) {
        //logObject(JSON.parse(reslt));
        var cachedLocations = JSON.parse(reslt);
        //sort based on the keyword, city and country names
        cachedLocations = fastFilter(cachedLocations, function (element) {
          if (element.country != undefined && element.city != undefined && element.query != undefined) {
            return (
              element.query.toLowerCase().trim() == queryOR.toLowerCase().trim() &&
              element.country.toLowerCase().trim() == _COUNTRY.toLowerCase().trim() &&
              element.city.toLowerCase().trim() == _CITY.toLowerCase().trim()
            );
          } //Invalid element
          else {
            return false;
          }
        });
        //...Check tolerance number
        if (cachedLocations.length > 0) {
          //Exists
          console.log("Cached data fetch");
          //logObject(removeResults_duplicates(cachedLocations));
          res({
            search_timestamp: timestamp,
            result: { search_timestamp: timestamp, result: removeResults_duplicates(cachedLocations).slice(0, 5) },
          });
        } //No results launch new search
        else {
          console.log("Launch new search");
          newLoaction_search_engine(queryOR, bbox, res, timestamp, collectionMongoDb);
        }
      } //No cached results
      else {
        //Launch new search
        console.log("Launch new search");
        newLoaction_search_engine(queryOR, bbox, res, timestamp, collectionMongoDb);
      }
    },
    (error) => {
      //Launch new search
      console.log("Launch new search");
      newLoaction_search_engine(queryOR, bbox, res, timestamp, collectionMongoDb);
    }
  );
}

dbPool.getConnection(function (err, connection) {
  clientMongo.connect(function (err) {
    //if (err) throw err;
    console.log("Connected to Mongodb");
    const dbMongo = clientMongo.db(DB_NAME_MONGODB);
    const collectionMongoDb = dbMongo.collection("searched_locations_persist");
    //-------------
    //Restore searched location cached if any from Mongodb
    var restoreCache = new Promise((reslv) => {
      restoreSearchedLocations_cache(reslv, collectionMongoDb);
    }).then(
      (result) => {},
      (err) => {
        //Initialize mongodb collection
        //Persist usual user searches
        console.log(err);
        dbMongo.collection("searched_locations_persist");
      }
    );
    //...
    //Cached restore OR initialized
    const bodyParser = require("body-parser");

    app.use(bodyParser.json());
    app.use(bodyParser.urlencoded({ extended: true }));

    //1. SEARCH API
    app.get("/getSearchedLocations", function (request, res) {
      resolveDate();
      //..
      let params = urlParser.parse(request.url, true);
      request = params.query;
      console.log(request);
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
          let request1 = new Promise((res, rej) => {
            let tmpTimestamp = search_timestamp;
            getLocationList_five(request.query, bbox, res, tmpTimestamp, collectionMongoDb);
          }).then(
            (result) => {
              if (parseInt(search_timestamp) != parseInt(result.search_timestamp)) {
                //Inconsistent - do not update
                //console.log('Inconsistent');
                res.send(false);
              } //Consistent - update
              else {
                //console.log('Consistent');
                //logObject(result);
                //socket.emit("getLocations-response", result);
                res.send(result);

                redisGet("search_locations").then((val) => {
                  //val
                  //logObject(JSON.parse(val).map(JSON.parse));
                });
              }
            },
            (error) => {
              console.log(error);
              //socket.emit("getLocations-response", false);
              res.send(false);
            }
          );
        },
        (error) => {
          console.log(error);
          //socket.emit("getLocations-response", false);
          res.send(false);
        }
      );
    });
  });
});

server.listen(port);
//dash.monitor({server: server});
