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
const port = 9000;

app
  .get("/", function (req, res) {
    res.sendFile(__dirname + "/tripSimulator.html");
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
   * update-passenger-location
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
        }
      });
    } //Invalid params
    else {
      socket.emit("trackdriverroute-response", false);
    }
  });
});

server.listen(port);
dash.monitor({ server: server });
