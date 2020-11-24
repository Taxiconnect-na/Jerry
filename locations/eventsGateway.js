var dash = require("appmetrics-dash");
var express = require("express");
const http = require("http");
const path = require("path");

var app = express();
var server = http.createServer(app);
const io = require("socket.io").listen(server);
const requestAPI = require("request");
const bodyParser = require("body-parser");
//....
var fastFilter = require("fast-filter");

var chaineDateUTC = null;
var dateObject = null;
const moment = require("moment");
const request = require("request");

function resolveDate() {
  //Resolve date
  var date = new Date();
  date = moment(date.getTime()).utcOffset(2);

  dateObject = date;
  date = date.year() + "-" + (date.month() + 1) + "-" + date.date() + " " + date.hour() + ":" + date.minute() + ":" + date.second();
  chaineDateUTC = date;
}
resolveDate();

//Crucial urls
const localURL = "http://localhost";
//EVENT GATEWAY PORT
//const port = 9000;
const port = 9097;

app
  .get("/", function (req, res) {
    res.send("[+] Events gateway running.");
  })
  .use(express.static(path.join(__dirname, "assets")))
  .use(bodyParser.json())
  .use(bodyParser.urlencoded({ extended: true }));

//EVENTS ROUTER
io.sockets.on("connection", function (socket) {
  console.log("Connected to the event gateway.");
  /**
   * MAP SERVICE, port 9090
   * Route: updatePassengerLocation
   * Event: update-passenger-location
   * Update the passenger's location in the system and prefetch the navigation data if any.
   */
  socket.on("update-passenger-location", function (req) {
    let servicePort = 9090;

    if (
      req !== undefined &&
      req.latitude !== undefined &&
      req.latitude !== null &&
      req.longitude !== undefined &&
      req.longitude !== null &&
      req.user_fingerprint !== null &&
      req.user_fingerprint !== undefined
    ) {
      let url =
        localURL +
        ":" +
        servicePort +
        "/updatePassengerLocation?latitude=" +
        req.latitude +
        "&longitude=" +
        req.longitude +
        "&user_fingerprint=" +
        req.user_fingerprint;
      requestAPI(url, function (error, response, body) {
        console.log(body);
        if (error === null) {
          try {
            body = JSON.parse(body);
            socket.emit("trackdriverroute-response", body);
          } catch (error) {
            socket.emit("trackdriverroute-response", false);
          }
        } else {
          socket.emit("trackdriverroute-response", false);
        }
      });
    } //Invalid params
    else {
      socket.emit("trackdriverroute-response", false);
    }
  });

  /**
   * MAP SERVICE
   * Get user location (reverse geocoding)
   */
  socket.on("geocode-this-point", function (req) {
    let servicePort = 9090;

    if (
      req.latitude !== undefined &&
      req.latitude !== null &&
      req.longitude !== undefined &&
      req.longitude !== null &&
      req.user_fingerprint !== null &&
      req.user_fingerprint !== undefined
    ) {
      let url =
        localURL +
        ":" +
        servicePort +
        "/getUserLocationInfos?latitude=" +
        req.latitude +
        "&longitude=" +
        req.longitude +
        "&user_fingerprint=" +
        req.user_fingerprint;
      requestAPI(url, function (error, response, body) {
        console.log(body);
        if (error === null) {
          try {
            body = JSON.parse(body);
            socket.emit("geocode-this-point-response", body);
          } catch (error) {
            socket.emit("geocode-this-point-response", false);
          }
        } else {
          socket.emit("geocode-this-point-response", false);
        }
      });
    } //Invalid params
    else {
      socket.emit("geocode-this-point-response", false);
    }
  });

  /**
   * MAP SERVICE
   * route name: identifyPickupLocation
   * params: latitude, longitude, user_fingerprint
   * Identify pickup location (taxi rank or private location)
   */
  socket.on("getPickupLocationNature", function (req) {
    console.log("identify location...");
    let servicePort = 9090;

    if (
      req.latitude !== undefined &&
      req.latitude !== null &&
      req.longitude !== undefined &&
      req.longitude !== null &&
      req.user_fingerprint !== null &&
      req.user_fingerprint !== undefined
    ) {
      let url =
        localURL +
        ":" +
        servicePort +
        "/identifyPickupLocation?latitude=" +
        req.latitude +
        "&longitude=" +
        req.longitude +
        "&user_fingerprint=" +
        req.user_fingerprint;
      requestAPI(url, function (error, response, body) {
        console.log(body);
        if (error === null) {
          try {
            body = JSON.parse(body);
            socket.emit("getPickupLocationNature-response", body);
          } catch (error) {
            socket.emit("getPickupLocationNature-response", false);
          }
        } else {
          socket.emit("getPickupLocationNature-response", false);
        }
      });
    } //Invalid params
    else {
      socket.emit("getPickupLocationNature-response", false);
    }
  });

  /**
   * SEARCH SERVICE, port 9091
   * Route: getSearchedLocations
   * Event: getSearchedLocations
   * Seached locations autocomplete.
   */
  socket.on("getLocations", function (req) {
    console.log(req);
    let servicePort = 9091;
    if (
      req.user_fp !== undefined &&
      req.user_fp !== null &&
      req.query !== undefined &&
      req.query !== null &&
      req.city !== undefined &&
      req.city !== null
    ) {
      let url = localURL + ":" + servicePort + "/getSearchedLocations?user_fp=" + req.user_fp + "&query=" + req.query + "&city=" + req.city;

      requestAPI(url, function (error, response, body) {
        console.log(body);
        if (error === null) {
          try {
            body = JSON.parse(body);
            socket.emit("getLocations-response", body);
          } catch (error) {
            socket.emit("getLocations-response", false);
          }
        } else {
          socket.emit("getLocations-response", false);
        }
      });
    } else {
      socket.emit("getLocations-response", false);
    }
  });

  /**
   * PRICING SERVICE, port 8989
   * Route: getOverallPricingAndAvailabilityDetails
   * event: getPricingForRideorDelivery
   * Get fare estimations for any ride or delivery booking
   */
  //socket.emit("getPricingForRideorDelivery");
  socket.on("getPricingForRideorDelivery", function (req) {
    let inputData = {
      user_fingerprint: "7c57cb6c9471fd33fd265d5441f253eced2a6307c0207dea57c987035b496e6e8dfa7105b86915da",
      carTypeSelected: "normalTaxiEconomy",
      connectType: "ConnectUs",
      country: "Namibia",
      isAllGoingToSameDestination: true,
      naturePickup: "PrivateLocation",
      passengersNo: 4,
      rideType: "RIDE",
      timeScheduled: "now",
      pickupData: {
        coordinates: [-22.522247, 17.058754],
        location_name: "Maerua mall",
        street_name: "Andromeda Street",
        city: "Windhoek",
      },
      destinationData: {
        passenger1Destination: {
          _id: "5f7de0f1622d1b3e401f9836",
          averageGeo: -11.1096514,
          city: "Windhoek",
          coordinates: [-22.613083449999998, 17.058163390586557],
          country: "Namibia",
          location_id: 359595673,
          location_name: "Health Sciences / UNAM Press (M Block)",
          query: "M",
          state: "Khomas",
          street: "Mandume Ndemufayo Avenue",
        },
        passenger2Destination: false,
        passenger3Destination: false,
        passenger4Destination: false,
      },
    };
    //Parse input date to the good format
    new Promise((res) => {
      parsePricingInputData(res, inputData);
    }).then(
      (reslt) => {
        console.log(reslt);
      },
      (error) => {
        console.log(error);
      }
    );
    console.log(req);
    let servicePort = 8989;
    /*if (
      req.user_fp !== undefined &&
      req.user_fp !== null &&
      req.query !== undefined &&
      req.query !== null &&
      req.city !== undefined &&
      req.city !== null
    ) {
      let url = localURL + ":" + servicePort + "/getSearchedLocations?user_fp=" + req.user_fp + "&query=" + req.query + "&city=" + req.city;

      requestAPI(url, function (error, response, body) {
        console.log(body);
        if (error === null) {
          try {
            body = JSON.parse(body);
            socket.emit("getLocations-response", body);
          } catch (error) {
            socket.emit("getLocations-response", false);
          }
        } else {
          socket.emit("getLocations-response", false);
        }
      });
    } else {
      socket.emit("getLocations-response", false);
    }*/
  });
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
        cleanInputData.request_type = /now/i.test(inputData.timeScheduled) ? "immediate" : "scheduled";
        new Promise((res) => {
          //..Deduct the pickup time if scheduled
          if (/scheduled/i.test(cleanInputData.request_type)) {
            let timeExtracted = inputData.timeScheduled.split(" ")[2].trim().split(":");
            let hourExtracted = timeExtracted[0];
            let minutesExtracted = timeExtracted[1];
            //Recreate now time
            let dateTMP = new Date();

            if (/tomorrow/i.test(inputData.timeScheduled)) {
              //Tomorrow, add 24h and do the same operation as above
              if (/Namibia/i.test(inputData.country))
                //GMT+2 in Namibia
                dateTMP = moment(dateTMP.getTime() + 86400000).utcOffset(2);
            }
            dateTMP = dateTMP.year() + "-" + (dateTMP.month() + 1) + "-" + dateTMP.date() + " " + hourExtracted + ":" + minutesExtracted + ":00";
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
              coordinates: { latitude: inputData.pickupData.coordinates[0], longitude: inputData.pickupData.coordinates[1] },
              location_name:
                inputData.pickupData.location_name !== undefined && inputData.pickupData.location_name !== false
                  ? inputData.pickupData.location_name
                  : false,
              street_name:
                inputData.pickupData.street_name !== undefined && inputData.pickupData.street_name !== false
                  ? inputData.pickupData.street_name
                  : false,
              suburb: false,
              state: false,
              city: inputData.pickupData.city,
            };

            new Promise((res) => {
              cleanInputData.destination_location_infos = [];
              let tmpSchemaArray = [1, 2, 3, 4]; //Just for iterations, nothing more, instead of using for loop
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
                        latitude: inputData.destinationData.passenger1Destination.coordinates[0],
                        longitude: inputData.destinationData.passenger1Destination.coordinates[1],
                      },
                      location_name:
                        inputData.destinationData.passenger1Destination.location_name !== undefined &&
                        inputData.destinationData.passenger1Destination.location_name !== false
                          ? inputData.destinationData.passenger1Destination.location_name
                          : false,
                      street_name:
                        inputData.destinationData.passenger1Destination.street !== undefined &&
                        inputData.destinationData.passenger1Destination.street !== false
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
                    let passenger1Data = inputData.destinationData.passenger1Destination;
                    cleanInputData.destination_location_infos.push({
                      passenger_number_id: 1,
                      dropoff_type: false,
                      coordinates: { latitude: passenger1Data.coordinates[0], longitude: passenger1Data.coordinates[1] },
                      location_name:
                        passenger1Data.location_name !== undefined && passenger1Data.location_name !== false ? passenger1Data.location_name : false,
                      street_name: passenger1Data.street !== undefined && passenger1Data.street !== false ? passenger1Data.street : false,
                      suburb: false,
                      state: false,
                      city: inputData.pickupData.city,
                    });
                    //Passenger2
                    let passenger2Data = inputData.destinationData.passenger2Destination;
                    cleanInputData.destination_location_infos.push({
                      passenger_number_id: 2,
                      dropoff_type: false,
                      coordinates: { latitude: passenger2Data.coordinates[0], longitude: passenger2Data.coordinates[1] },
                      location_name:
                        passenger2Data.location_name !== undefined && passenger2Data.location_name !== false ? passenger2Data.location_name : false,
                      street_name: passenger2Data.street !== undefined && passenger2Data.street !== false ? passenger2Data.street : false,
                      suburb: false,
                      state: false,
                      city: inputData.pickupData.city,
                    });
                    //Done
                    res(cleanInputData);
                  } else if (cleanInputData.passengers_number == 3) {
                    //Passenger1
                    let passenger1Data = inputData.destinationData.passenger1Destination;
                    cleanInputData.destination_location_infos.push({
                      passenger_number_id: 1,
                      dropoff_type: false,
                      coordinates: { latitude: passenger1Data.coordinates[0], longitude: passenger1Data.coordinates[1] },
                      location_name:
                        passenger1Data.location_name !== undefined && passenger1Data.location_name !== false ? passenger1Data.location_name : false,
                      street_name: passenger1Data.street !== undefined && passenger1Data.street !== false ? passenger1Data.street : false,
                      suburb: false,
                      state: false,
                      city: inputData.pickupData.city,
                    });
                    //Passenger2
                    let passenger2Data = inputData.destinationData.passenger2Destination;
                    cleanInputData.destination_location_infos.push({
                      passenger_number_id: 2,
                      dropoff_type: false,
                      coordinates: { latitude: passenger2Data.coordinates[0], longitude: passenger2Data.coordinates[1] },
                      location_name:
                        passenger2Data.location_name !== undefined && passenger2Data.location_name !== false ? passenger2Data.location_name : false,
                      street_name: passenger2Data.street !== undefined && passenger2Data.street !== false ? passenger2Data.street : false,
                      suburb: false,
                      state: false,
                      city: inputData.pickupData.city,
                    });
                    //Passenger3
                    let passenger3Data = inputData.destinationData.passenger3Destination;
                    cleanInputData.destination_location_infos.push({
                      passenger_number_id: 3,
                      dropoff_type: false,
                      coordinates: { latitude: passenger3Data.coordinates[0], longitude: passenger3Data.coordinates[1] },
                      location_name:
                        passenger3Data.location_name !== undefined && passenger3Data.location_name !== false ? passenger3Data.location_name : false,
                      street_name: passenger3Data.street !== undefined && passenger3Data.street !== false ? passenger3Data.street : false,
                      suburb: false,
                      state: false,
                      city: inputData.pickupData.city,
                    });
                    //Done
                    res(cleanInputData);
                  } else if (cleanInputData.passengers_number == 4) {
                    //Passenger1
                    let passenger1Data = inputData.destinationData.passenger1Destination;
                    cleanInputData.destination_location_infos.push({
                      passenger_number_id: 1,
                      dropoff_type: false,
                      coordinates: { latitude: passenger1Data.coordinates[0], longitude: passenger1Data.coordinates[1] },
                      location_name:
                        passenger1Data.location_name !== undefined && passenger1Data.location_name !== false ? passenger1Data.location_name : false,
                      street_name: passenger1Data.street !== undefined && passenger1Data.street !== false ? passenger1Data.street : false,
                      suburb: false,
                      state: false,
                      city: inputData.pickupData.city,
                    });
                    //Passenger2
                    let passenger2Data = inputData.destinationData.passenger2Destination;
                    cleanInputData.destination_location_infos.push({
                      passenger_number_id: 2,
                      dropoff_type: false,
                      coordinates: { latitude: passenger2Data.coordinates[0], longitude: passenger2Data.coordinates[1] },
                      location_name:
                        passenger2Data.location_name !== undefined && passenger2Data.location_name !== false ? passenger2Data.location_name : false,
                      street_name: passenger2Data.street !== undefined && passenger2Data.street !== false ? passenger2Data.street : false,
                      suburb: false,
                      state: false,
                      city: inputData.pickupData.city,
                    });
                    //Passenger3
                    let passenger3Data = inputData.destinationData.passenger3Destination;
                    cleanInputData.destination_location_infos.push({
                      passenger_number_id: 3,
                      dropoff_type: false,
                      coordinates: { latitude: passenger3Data.coordinates[0], longitude: passenger3Data.coordinates[1] },
                      location_name:
                        passenger3Data.location_name !== undefined && passenger3Data.location_name !== false ? passenger3Data.location_name : false,
                      street_name: passenger3Data.street !== undefined && passenger3Data.street !== false ? passenger3Data.street : false,
                      suburb: false,
                      state: false,
                      city: inputData.pickupData.city,
                    });
                    //Passenger4
                    let passenger4Data = inputData.destinationData.passenger4Destination;
                    cleanInputData.destination_location_infos.push({
                      passenger_number_id: 4,
                      dropoff_type: false,
                      coordinates: { latitude: passenger4Data.coordinates[0], longitude: passenger4Data.coordinates[1] },
                      location_name:
                        passenger4Data.location_name !== undefined && passenger4Data.location_name !== false ? passenger4Data.location_name : false,
                      street_name: passenger4Data.street !== undefined && passenger4Data.street !== false ? passenger4Data.street : false,
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
                    latitude: inputData.destinationData.passenger1Destination.coordinates[0],
                    longitude: inputData.destinationData.passenger1Destination.coordinates[1],
                  },
                  location_name:
                    inputData.destinationData.passenger1Destination.location_name !== undefined &&
                    inputData.destinationData.passenger1Destination.location_name !== false
                      ? inputData.destinationData.passenger1Destination.location_name
                      : false,
                  street_name:
                    inputData.destinationData.passenger1Destination.street !== undefined &&
                    inputData.destinationData.passenger1Destination.street !== false
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
        resolve(false);
      }
    } //Invalid data
    else {
      resolve(false);
    }
  }
});

server.listen(port);
//dash.monitor({ server: server });
