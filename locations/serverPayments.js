var express = require("express");
const http = require("http");
const fs = require("fs");
const path = require("path");
const MongoClient = require("mongodb").MongoClient;
var parser = require("xml2json");

var app = express();
var server = http.createServer(app);
const io = require("socket.io").listen(server);
const mysql = require("mysql");
const requestAPI = require("request");
//....
var fastFilter = require("fast-filter");
const { promisify, inspect, isRegExp } = require("util");
var chaineDateUTC = null;
var dateObject = null;
const moment = require("moment");
const e = require("express");

const URL_MONGODB = "mongodb://localhost:27017";
const DB_NAME_MONGODB = "riders_data_schemeless";

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

const port = 9090;

//Database connection
const dbPool = mysql.createPool({
  connectionLimit: 1000000000,
  host: "localhost",
  database: "taxiconnect",
  user: "root",
  password: "",
});

/**
 * @func isUser_authenticated()
 * Check whether the user is authentic or not
 * Check from mongoDB first, if record not present check from mySQL (not recommended!)
 * - Fingerprint checking
 */

function isUser_authenticated(user_fp = false, collectionRidersData_repr, dbMysqlConnection, resolve) {
  resolveDate();
  //...
  if (user_fp !== false) {
    collectionRidersData_repr.find({ user_fingerprint: user_fp }).toArray(function (err, result) {
      if (result === null || result.length === 0) {
        //NO records found in mongo, check mySQL
        new Promise((reslv) => {
          getUserProfile_RecordMysql(user_fp, dbMysqlConnection, reslv);
        }).then(
          (reslt) => {
            //Update mongo record
            let riderProfile = {
              user_fingerprint: reslt.fingerprint,
              name: reslt.name,
              surname: reslt.surname,
              gender: reslt.gender,
              phone: reslt.phone_number,
              profile_pic: reslt.profile_pic,
              isAccount_verified: reslt.isAccount_verified,
              pushnotif_token: reslt.pushnotif_token,
              password: reslt.password,
              date_logged: chaineDateUTC,
            };
            collectionRidersData_repr.insertOne(riderProfile, function (err, res) {
              if (err) {
                resolve(false);
                throw err;
              }
              //...
              resolve(true);
            });
          },
          (error) => {
            console.log(error);
            resolve(false);
          }
        );
      } //Record found, check fps
      else {
        if (result[0].user_fingerprint.trim() == user_fp) {
          //Auth
          resolve(true);
        } //Not auth
        else {
          resolve(false);
        }
      }
    });
  } else {
    resolve(false);
  }
}

/**
 * @func getUserProfile_RecordMysql()
 * Getting the user record from mysql and save it in mongo as well.
 */
function getUserProfile_RecordMysql(user_fp = false, dbMysqlConnection, resolve) {
  if (user_fp !== false) {
    dbMysqlConnection.query("SELECT * FROM central_passengers_profiles WHERE fingerprint=" + mysql.escape(user_fp), function (err, rows, fields) {
      if (rows !== undefined && rows[0] !== undefined && rows[0].fingerprint !== undefined) {
        //Found a record
        resolve(rows[0]);
      } //Not found
      else {
        resolve(false);
      }
    });
  } //Not found
  else {
    resolve(false);
  }
}

/**
 * @func dispatchMessageDone_process()
 * Used to dispatch responses based on the state of the request
 */

function dispatchMessageDone_process(response, message = "error", socket) {
  console.log(response);
  if (response === false) {
    //Error somewhere
    socket.emit("paymentCreditTopup-response", { response: false, message: message });
  } else {
    socket.emit("paymentCreditTopup-response", { response: "success" });
  }
}

/**
 * @func deductXML_responses()
 * @params XML content, step (createToken, chargeTokenCreditCard)
 * Return responses deducted from XML responses or invalid if invalid.
 * CREATE TOKEN
 * 000 Transaction created
 * 801 Request missing company token
 * 802 Company token does not exist
 * 803 No request or error in Request type name
 * 804 Error in XML
 * 902 Request missing transaction level mandatory fields - name of field
 * 904 Currency not supported
 * 905 The transaction amount has exceeded your allowed transaction limit, please contact: support@directpay.online
 * 906 You exceeded your monthly transactions limit, please contact: support@directpay.online
 * 922 Provider does not exist
 * 923 Allocated money exceeds payment amount
 * 930 Block payment code incorrect
 * 940 CompanyREF already exists and paid
 * 950 Request missing mandatory fields - name of field, Request fields empty
 * 960 Tag has been sent multiple times
 *
 * CHARGE CREDIT CARD
 * 000 Transaction charged
 * 200 Transaction already paid
 * 801 Request missing company token
 * 802 Wrong CompanyToken
 * 803 No request or error in Request type name
 * 804 Error in XML
 * 902 Data mismatch in one of the fields – fieldname
 * 950 Request missing mandatory fields – fieldname
 * 999 Transaction Declined - Explanation
 *
 */

function deductXML_responses(contentResponse, stepProcess, resolve) {
  if (contentResponse == "" && contentResponse.length === 0) {
    //Error
    console.log("Error");
  } else {
    //Proceed with the transaction
    try {
      contentResponse = parser.toJson(contentResponse);
      if (stepProcess == "createToken") {
        console.log(contentResponse);
      } else if (stepProcess == "chargeTokenCreditCard") {
        console.log("charge credit card.");
      }
    } catch (error) {
      resolve(false);
    }
  }
}

/**
 * MAIN
 */

dbPool.getConnection(function (err, connection) {
  clientMongo.connect(function (err) {
    //if (err) throw err;
    console.log("Connected to Mongodb");
    const dbMongo = clientMongo.db(DB_NAME_MONGODB);
    const collectionRidersData_repr = dbMongo.collection("riders_data_representation"); //Hold the information about the riders
    const collectionRidersData_repr_topups = dbMongo.collection("riders_data_topups_repr"); //Hold the latest information about the riders topups
    //-------------
    const bodyParser = require("body-parser");
    app.get("/", function (req, res) {
      res.sendFile(__dirname + "/tripSimulator.html");
    });
    app.use(express.static(path.join(__dirname, "assets")));
    // support parsing of application/json type post data
    app.use(bodyParser.json());
    //support parsing of application/x-www-form-urlencoded post data
    app.use(bodyParser.urlencoded({ extended: true }));

    /**
     * SOCKETS
     */
    io.sockets.on("connection", function (socket) {
      console.log("client connected");

      socket.on("paymentCreditTopup", function (dataBundle) {
        //console.log(dataBundle);
        //Check the user
        new Promise((resolve) => {
          isUser_authenticated(dataBundle.user_fp, collectionRidersData_repr, connection, resolve);
        }).then(
          (result) => {
            console.log(result);
            //Proceed to payment
            if (result === true) {
              console.log("user authenticated");
              //...
              let xmlCreateToken = `
                
              `;
            } //Error
            else {
              dispatchMessageDone_process(false, "auth_error", socket);
            }
          },
          (error) => {
            console.log(error);
            dispatchMessageDone_process(false, "auth_error", socket);
          }
        );
      });
    });
  });
});

server.listen(port);
