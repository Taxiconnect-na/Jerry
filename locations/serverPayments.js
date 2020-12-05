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
const crypto = require("crypto");
//....
var fastFilter = require("fast-filter");
const { promisify, inspect, isRegExp } = require("util");
var chaineDateUTC = null;
var dateObject = null;
var dateObjectImute = null;
const moment = require("moment");
const e = require("express");
const { response } = require("express");

const URL_MONGODB = "mongodb://localhost:27017";
const DB_NAME_MONGODB = "Taxiconnect";
const TOKEN_PAYMENT_CP = "9F416C11-127B-4DE2-AC7F-D5710E4C5E0A";
const REDIRECT_URL_AFTER_PROCESSES = "https://taxiconnectna.com";
const COMPANY_DPO_REF = "49FKEOA"; //Company;s ref on DPO
const DPO_CREATETOKEN_SERVICE_TYPE = "3854"; //Purchase type
const DPO_PAYMENT_ENDPOINT = "https://secure1.sandbox.directpay.online/API/v6/";

const clientMongo = new MongoClient(URL_MONGODB, { useUnifiedTopology: true });

function resolveDate() {
  //Resolve date
  var date = new Date();
  date = moment(date.getTime()).utcOffset(2);

  dateObject = date;
  //Reformat date in the formate YYYY/MM/DD HH:MM
  //month
  if (date.month() < 9) {
    dateObjectImute = date.year() + "/0" + (date.month() + 1); //Keep in object form.
  } else {
    dateObjectImute = date.year() + "/" + (date.month() + 1); //Keep in object form.
  }
  //...date
  if (date.date() < 10) {
    dateObjectImute += "/0" + date.date(); //Keep in object form.
  } else {
    dateObjectImute += "/" + date.date(); //Keep in object form.
  }
  //...hour
  if (date.hour() < 10) {
    dateObjectImute += " 0" + date.hour(); //Keep in object form.
  } else {
    dateObjectImute += " " + date.hour(); //Keep in object form.
  }
  //...minute
  if (date.minute() < 10) {
    dateObjectImute += ":0" + date.minute(); //Keep in object form.
  } else {
    dateObjectImute += ":" + date.minute(); //Keep in object form.
  }

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
        resolve(contentResponse);
      } else if (stepProcess == "chargeTokenCreditCard") {
        resolve(contentResponse);
      } else {
        resolve(false);
      }
    } catch (error) {
      resolve(false);
    }
  }
}

/**
 * @func createPaymentTransaction
 * Responsible for creating transaction preliminary to the payment
 * and save in mongo a record, BUT  up date mySQL for stronghold keep.
 */

function createPaymentTransaction(xmlBody, user_fp, collectionRidersData_repr_topups, resolve) {
  if (user_fp !== undefined && user_fp !== null) {
    requestAPI.post(
      {
        url: DPO_PAYMENT_ENDPOINT,
        method: "POST",
        headers: {
          "Content-Type": "application/xml",
        },
        body: xmlBody,
      },
      function (error, response, body) {
        //Save the general log, status code and error
        new Promise((reslv) => {
          saveLogForTopups(user_fp, body, error, response.statusCode, collectionRidersData_repr_topups, reslv);
        }).then(
          () => {},
          () => {}
        );
        ///...
        if (response.statusCode === 200) {
          //Good
          if (error === null) {
            resolve(body);
          } //Error
          else {
            resolve(false);
          }
        } //Error
        else {
          //Save the log, status code and error
          resolve(false);
        }
      }
    );
  } else {
    resolve(false);
  }
}

/**
 * @func executePaymentTransaction
 * Responsible for making the true payment using the transaction token previously generated
 */

function executePaymentTransaction(xmlBody, user_fp, collectionRidersData_repr_topups, resolve) {
  if (user_fp !== undefined && user_fp !== null) {
    requestAPI.post(
      {
        url: DPO_PAYMENT_ENDPOINT,
        method: "POST",
        headers: {
          "Content-Type": "application/xml",
        },
        body: xmlBody,
      },
      function (error, response, body) {
        console.log(body, response.statusCode);
        //Save the general log, status code and error
        new Promise((reslv) => {
          saveLogForTopups(user_fp, body, error, response.statusCode, collectionRidersData_repr_topups, reslv);
        }).then(
          () => {},
          () => {}
        );
        ///...
        if (response.statusCode === 200) {
          //Good
          if (error === null) {
            resolve(body);
          } //Error
          else {
            resolve(false);
          }
        } //Error
        else {
          //Save the log, status code and error
          resolve(false);
        }
      }
    );
  } else {
    resolve(false);
  }
}

/**
 * @func saveLogForTopups
 * Save logs related to transactions for logs linked to user fingerprints
 */
function saveLogForTopups(user_fp, responseBody, responseError, responseStatusCode, collectionRidersData_repr_topups, resolve) {
  resolveDate();
  let dataBundle = {
    user_fingerprint: user_fp,
    responseBody: responseBody,
    responseError: responseError,
    responseStatusCode: responseStatusCode,
    date_captured: chaineDateUTC,
  };
  collectionRidersData_repr_topups.insertOne(dataBundle, function (err, res) {
    if (err) {
      resolve(false);
      throw err;
    }
    resolve(true);
  });
}

/**
 * @func saveLogForTopupsSuccess
 * Update rider profile with latest successful topup information
 */
function saveLogForTopupsSuccess(user_fp, amount, transactionToken, transactionRef, collectionRidersData_repr, resolve) {
  resolveDate();
  let dataBundle = {
    amount: amount,
    transactionToken: transactionToken,
    transactionRef: transactionRef,
    date_captured: chaineDateUTC,
  };
  let FinderQuery = {
    user_fingerprint: user_fp,
  };
  let updateQuery = { $set: { latestTopup_history: dataBundle } };
  collectionRidersData_repr.updateOne(FinderQuery, updateQuery, function (err, res) {
    if (err) {
      resolve(false);
      throw err;
    }
    resolve(true);
  });
}

/**
 * @func updateRecordStrongholdVouchers()
 * Very important: responsible for updating the mySQL database stronghold.
 */
function updateRecordStrongholdVouchers(user_fp, amount, transactionToken, transactionRef, dbMysqlConnection, resolve) {
  resolveDate();
  if (user_fp !== undefined && user_fp !== null) {
    //Update central vouchers and credit rides recharges in mysql
    new Promise((reslv) => {}).then(
      (result) => {
        console.log(result);
      },
      (error) => {
        console.log(error);
        resolve(false);
      }
    );
  } else {
    resolve(false);
  }
}

/**
 * @func updateMySQLStronghold()
 * Update voucher part of the main stronghold, based on the predefined schema in place.
 */
function updateMySQLStronghold(user_fp, amount, transactionToken, transactionRef, dbMysqlConnection, resolve) {
  //Get unique fingerprint
  new Promise((reslv) => {
    generateUniqueFingerprint(user_fp + "" + transactionToken + "" + transactionRef + "" + chaineDateUTC, reslv);
  }).then(
    (result) => {
      let fingerprint = result;
      //Update central vouchers
      let queryUpdate_centralVouchers =
        "INSERT INTO central_vouchers(voucher_number, unique_fingerprint, value, date_generated) VALUES(" +
        mysql.escape(fingerprint) +
        "," +
        mysql.escape(fingerprint) +
        "," +
        mysql.escape(amount) +
        "," +
        mysql.escape(chaineDateUTC) +
        ")";
      dbMysqlConnection.query(queryUpdate_centralVouchers, function () {
        //Update credit rides recharges
        let queryUpdate_ridesRecharges =
          "INSERT INTO credit_rides_recharges(user_id, voucher_used, date_recharged) VALUES(" +
          mysql.escape(user_fp) +
          "," +
          mysql.escape(fingerprint) +
          "," +
          mysql.escape(chaineDateUTC) +
          ")";
        dbMysqlConnection.query(queryUpdate_ridesRecharges, function () {
          //Done
          resolve(true);
        });
      });
    },
    (error) => {
      //Use the transaction token + transactionRef as fingerprint
      let fingerprint = transactionToken + "" + transactionRef;
      //Update central vouchers
      let queryUpdate_centralVouchers =
        "INSERT INTO central_vouchers(voucher_number, unique_fingerprint, value, date_generated) VALUES(" +
        mysql.escape(fingerprint) +
        "," +
        mysql.escape(fingerprint) +
        "," +
        mysql.escape(amount) +
        "," +
        mysql.escape(chaineDateUTC) +
        ")";
      dbMysqlConnection.query(queryUpdate_centralVouchers, function () {
        //Update credit rides recharges
        let queryUpdate_ridesRecharges =
          "INSERT INTO credit_rides_recharges(user_id, voucher_used, date_recharged) VALUES(" +
          mysql.escape(user_fp) +
          "," +
          mysql.escape(fingerprint) +
          "," +
          mysql.escape(chaineDateUTC) +
          ")";
        dbMysqlConnection.query(queryUpdate_ridesRecharges, function () {
          //Done
          resolve(true);
        });
      });
    }
  );
}

/**
 * @func generateUniqueFingerprint()
 * Generate unique fingerprint for any string size.
 */
function generateUniqueFingerprint(str, resolve) {
  str = str.trim();
  let fingerprint = crypto.createHmac("sha256", "TAXICONNECTBASICKEYFINGERPRINTS").update(str).digest("hex");
  resolve(fingerprint);
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
    const collectionRidersData_repr_topups = dbMongo.collection("wallet_transactions_logs"); //Hold the latest information about the riders topups
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
        console.log(dataBundle);
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
              let xmlCreateToken =
                `
              <?xml version="1.0" encoding="utf-8"?>
              <API3G>
              <CompanyToken>` +
                TOKEN_PAYMENT_CP +
                `</CompanyToken>
              <Request>createToken</Request>
              <Transaction>
              <PaymentAmount>` +
                dataBundle.amount +
                `</PaymentAmount>
              <PaymentCurrency>NAD</PaymentCurrency>
              <CompanyRef>` +
                COMPANY_DPO_REF +
                `</CompanyRef>
              <RedirectURL>` +
                REDIRECT_URL_AFTER_PROCESSES +
                `</RedirectURL>
              <BackURL>` +
                REDIRECT_URL_AFTER_PROCESSES +
                `</BackURL>
              <CompanyRefUnique>0</CompanyRefUnique>
              <PTL>5</PTL>
              </Transaction>
              <Services>
                <Service>
                  <ServiceType>` +
                DPO_CREATETOKEN_SERVICE_TYPE +
                `</ServiceType>
                  <ServiceDescription>TaxiConnect wallet top-up</ServiceDescription>
                  <ServiceDate>` +
                dateObjectImute +
                `</ServiceDate>
                </Service>
              </Services>
              </API3G>
              `;

              console.log(xmlCreateToken);

              //CREATE TOKEN
              new Promise((resolve) => {
                createPaymentTransaction(xmlCreateToken, dataBundle.user_fp, collectionRidersData_repr_topups, resolve);
              }).then(
                (reslt) => {
                  console.log(reslt);
                  //Deduct XML response
                  new Promise((resolve) => {
                    deductXML_responses(reslt, "createToken", resolve);
                  }).then(
                    (result) => {
                      console.log(result);
                      if (result !== false) {
                        try {
                          result = JSON.parse(result);
                          if (result.API3G.Result === "000" || result.API3G.Result == "000") {
                            console.log("Executing payment");
                            let transactionToken = result.API3G.TransToken;
                            let transRef = result.API3G.TransRef;
                            dataBundle.number = dataBundle.number.replace(" ", "").replace(" ", "").replace(" ", "");
                            dataBundle.expiry = dataBundle.expiry.replace("/", "");
                            //DEBUG CARD-------------------------------------------------------------------------------
                            dataBundle.number = "5436886269848367";
                            dataBundle.expiry = "1222";
                            dataBundle.cvv = "123";
                            //....-------------------------------------------------------------------------------------

                            //...
                            //MAKE PAYMENT
                            let xmlMakePayment =
                              `
                        <?xml version="1.0" encoding="utf-8"?>
                        <API3G>
                          <CompanyToken>` +
                              TOKEN_PAYMENT_CP +
                              `</CompanyToken>
                          <Request>chargeTokenCreditCard</Request>
                          <TransactionToken>` +
                              transactionToken +
                              `</TransactionToken>
                          <CreditCardNumber>` +
                              dataBundle.number +
                              `</CreditCardNumber>
                          <CreditCardExpiry>` +
                              dataBundle.expiry +
                              `</CreditCardExpiry>
                          <CreditCardCVV>` +
                              dataBundle.cvv +
                              `</CreditCardCVV>
                          <CardHolderName>` +
                              dataBundle.name +
                              `</CardHolderName>
                          <ChargeType></ChargeType>
                        </API3G>
                        `;
                            console.log(xmlMakePayment);
                            //Execute payment
                            new Promise((resolve) => {
                              executePaymentTransaction(xmlMakePayment, dataBundle.user_fp, collectionRidersData_repr_topups, resolve);
                            }).then(
                              (result) => {
                                console.log(result);
                                new Promise((resolve) => {
                                  deductXML_responses(result, "chargeTokenCreditCard", resolve);
                                }).then(
                                  (result) => {
                                    if (result !== false) {
                                      try {
                                        result = JSON.parse(result);
                                        console.log(result);
                                        if (result.API3G.Result === "000" || result.API3G.Result == "000") {
                                          //SUCCESS
                                          //Update topup success mongo log
                                          new Promise((resolve) => {
                                            saveLogForTopupsSuccess(
                                              dataBundle.user_fp,
                                              dataBundle.amount,
                                              transactionToken,
                                              transRef,
                                              collectionRidersData_repr,
                                              resolve
                                            );
                                          }).then(
                                            (result) => {
                                              console.log(result);
                                            },
                                            (error) => {
                                              console.log(error);
                                            }
                                          );

                                          //Update mysql stronghold
                                          new Promise((resolve) => {
                                            updateMySQLStronghold(
                                              dataBundle.user_fp,
                                              dataBundle.amount,
                                              transactionToken,
                                              transRef,
                                              connection,
                                              resolve
                                            );
                                          }).then(
                                            (result) => {
                                              console.log(result);
                                              if (result !== false) {
                                                //Update mongo rider profile
                                                new Promise((resolve) => {
                                                  saveLogForTopupsSuccess(
                                                    dataBundle.user_fp,
                                                    dataBundle.amount,
                                                    transactionToken,
                                                    transRef,
                                                    collectionRidersData_repr,
                                                    resolve
                                                  );
                                                }).then(
                                                  (result) => {
                                                    console.log(result);
                                                    //DONE - SUCCESSFULLY PAID
                                                    dispatchMessageDone_process(true, false, socket);
                                                  },
                                                  (error) => {
                                                    console.log(error);
                                                    dispatchMessageDone_process(false, "payment_error", socket);
                                                  }
                                                );
                                              } //Error
                                              else {
                                                dispatchMessageDone_process(false, "payment_error", socket);
                                              }
                                            },
                                            (error) => {
                                              console.log(error);
                                              dispatchMessageDone_process(false, "payment_error", socket);
                                            }
                                          );
                                        }
                                      } catch (error) {
                                        dispatchMessageDone_process(false, "payment_error", socket);
                                      }
                                    } //Error
                                    else {
                                      dispatchMessageDone_process(false, "payment_error", socket);
                                    }
                                  },
                                  (error) => {
                                    console.log(error);
                                    dispatchMessageDone_process(false, "payment_error", socket);
                                  }
                                );
                              },
                              (error) => {
                                console.log(error);
                                dispatchMessageDone_process(false, "payment_error", socket);
                              }
                            );
                          } //Error transaction could not be create
                          else {
                            dispatchMessageDone_process(false, "transaction_error", socket);
                          }
                        } catch (error) {
                          dispatchMessageDone_process(false, "transaction_error", socket);
                        }
                      } //Error
                      else {
                        dispatchMessageDone_process(false, "transaction_error", socket);
                      }
                    },
                    (error) => {
                      console.log(error);
                      dispatchMessageDone_process(false, "token_error", socket);
                    }
                  );
                },
                (error) => {
                  dispatchMessageDone_process(false, "token_error", socket);
                }
              );
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
