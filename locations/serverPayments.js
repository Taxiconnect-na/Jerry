require("dotenv").config();
var express = require("express");
const http = require("http");
const fs = require("fs");
const path = require("path");
const MongoClient = require("mongodb").MongoClient;
var parser = require("xml2json");

var app = express();
var server = http.createServer(app);
const io = require("socket.io")(server);
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

const clientMongo = new MongoClient(process.env.URL_MONGODB, {
  useUnifiedTopology: true,
});

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
  chaineDateUTC = date;
}
resolveDate();

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
 * @param xmlBody: the DPO specific XML to create a transaction token.
 * @param user_fp: the rider's fingerprint.
 * @param collectionWalletTransactions_logs: the collection holding all the riders.
 * @param resolve
 */

function createPaymentTransaction(
  xmlBody,
  user_fp,
  collectionWalletTransactions_logs,
  resolve
) {
  if (user_fp !== undefined && user_fp !== null) {
    requestAPI.post(
      {
        url: process.env.DPO_PAYMENT_ENDPOINT,
        method: "POST",
        headers: {
          "Content-Type": "application/xml",
        },
        body: xmlBody,
      },
      function (error, response, body) {
        console.log(error, body);
        //Save the general log, status code and error
        new Promise((reslv) => {
          saveLogForTopups(
            user_fp,
            body,
            error,
            response.statusCode,
            collectionWalletTransactions_logs,
            reslv
          );
        }).then(
          () => {},
          () => {}
        );
        ///...
        if (
          /xml/i.test(new String(body)) ||
          response.statusCode === 200 ||
          error === null
        ) {
          //Received an XML response
          resolve(body);
        }
        //Error
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

function executePaymentTransaction(
  xmlBody,
  user_fp,
  collectionWalletTransactions_logs,
  resolve
) {
  if (user_fp !== undefined && user_fp !== null) {
    requestAPI.post(
      {
        url: process.env.DPO_PAYMENT_ENDPOINT,
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
          saveLogForTopups(
            user_fp,
            body,
            error,
            response.statusCode,
            collectionWalletTransactions_logs,
            reslv
          );
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
function saveLogForTopups(
  user_fp,
  responseBody,
  responseError,
  responseStatusCode,
  collectionWalletTransactions_logs,
  resolve
) {
  resolveDate();
  let dataBundle = {
    user_fingerprint: user_fp,
    responseBody: responseBody,
    responseError: responseError,
    responseStatusCode: responseStatusCode,
    date_captured: chaineDateUTC,
  };
  collectionWalletTransactions_logs.insertOne(dataBundle, function (err, res) {
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
function saveLogForTopupsSuccess(
  user_fp,
  amount,
  transactionToken,
  transactionRef,
  collectionPassengers_profiles,
  resolve
) {
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
  collectionPassengers_profiles.updateOne(
    FinderQuery,
    updateQuery,
    function (err, res) {
      if (err) {
        resolve(false);
      }
      resolve(true);
    }
  );
}

/**
 * MAIN
 */

clientMongo.connect(function (err) {
  //if (err) throw err;
  console.log("[*] Payments services up");
  const dbMongo = clientMongo.db(process.env.DB_NAME_MONGODDB);
  const collectionPassengers_profiles = dbMongo.collection(
    "passengers_profiles"
  ); //Hold the information about the riders
  const collectionDrivers_profiles = dbMongo.collection("drivers_profiles"); //Hold all the drivers profiles
  const collectionWalletTransactions_logs = dbMongo.collection(
    "wallet_transactions_logs"
  ); //Hold the latest information about the riders topups
  const collectionRidesDeliveryData = dbMongo.collection(
    "rides_deliveries_requests"
  ); //Hold all the requests made (rides and deliveries)
  const collectionGlobalEvents = dbMongo.collection("global_events"); //Hold all the random events that happened somewhere.
  //-------------
  const bodyParser = require("body-parser");
  app
    .get("/", function (req, res) {
      console.log("Payments services up");
    })
    .use(bodyParser.json({ limit: "100mb", extended: true }))
    .use(bodyParser.urlencoded({ limit: "100mb", extended: true }));

  /**
   * WALLET TOP-UP
   * Responsible for topping up wallets and securing the all process
   */
  app.post("/topUPThisWalletTaxiconnect", function (req, res) {
    resolveDate();
    //...
    let dataBundle = {
      user_fp: "funnyfingerprint",
      amount: 45,
      number: 1,
      expiry: 1,
      cvv: 1,
      name: "Dominique",
      type: "VISA",
    };

    //CREATE TOKEN
    new Promise((resolve) => {
      //? XML TOKEN responsible for creating a transaction token before any payment.
      let xmlCreateToken = `
      <?xml version="1.0" encoding="utf-8"?>
      <API3G>
      <CompanyToken>${process.env.TOKEN_PAYMENT_CP}</CompanyToken>
      <Request>createToken</Request>
      <Transaction>
      <PaymentAmount>${dataBundle.amount}</PaymentAmount>
      <PaymentCurrency>NAD</PaymentCurrency>
      <CompanyRef>${process.env.COMPANY_DPO_REF}</CompanyRef>
      <RedirectURL>${process.env.REDIRECT_URL_AFTER_PROCESSES}</RedirectURL>
      <BackURL>$${process.env.REDIRECT_URL_AFTER_PROCESSES}</BackURL>
      <CompanyRefUnique>0</CompanyRefUnique>
      <PTL>5</PTL>
      </Transaction>
      <Services>
        <Service>
          <ServiceType>${process.env.DPO_CREATETOKEN_SERVICE_TYPE}</ServiceType>
          <ServiceDescription>TaxiConnect wallet top-up</ServiceDescription>
          <ServiceDate>${dateObjectImute}</ServiceDate>
        </Service>
      </Services>
      </API3G>
      `;

      console.log(xmlCreateToken);
      createPaymentTransaction(
        xmlCreateToken,
        dataBundle.user_fp,
        collectionWalletTransactions_logs,
        resolve
      );
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
                if (
                  result.API3G.Result === "000" ||
                  result.API3G.Result == "000"
                ) {
                  console.log("Executing payment");
                  let transactionToken = result.API3G.TransToken;
                  let transRef = result.API3G.TransRef;
                  dataBundle.number = dataBundle.number
                    .replace(" ", "")
                    .replace(" ", "")
                    .replace(" ", "");
                  dataBundle.expiry = dataBundle.expiry.replace("/", "");
                  //DEBUG CARD-------------------------------------------------------------------------------
                  dataBundle.number = "5436886269848367";
                  dataBundle.expiry = "1222";
                  dataBundle.cvv = "123";
                  //....-------------------------------------------------------------------------------------

                  //...
                  //MAKE PAYMENT
                  //? XML TOKEN responsible for making the payment.
                  let xmlMakePayment = `
                      <?xml version="1.0" encoding="utf-8"?>
                      <API3G>
                        <CompanyToken>${process.env.TOKEN_PAYMENT_CP}</CompanyToken>
                        <Request>chargeTokenCreditCard</Request>
                        <TransactionToken>${transactionToken}</TransactionToken>
                        <CreditCardNumber>${dataBundle.number}</CreditCardNumber>
                        <CreditCardExpiry>${dataBundle.expiry}</CreditCardExpiry>
                        <CreditCardCVV>${dataBundle.cvv}</CreditCardCVV>
                        <CardHolderName>${dataBundle.name}</CardHolderName>
                        <ChargeType></ChargeType>
                      </API3G>
                      `;
                  console.log(xmlMakePayment);
                  //Execute payment
                  new Promise((resolve) => {
                    executePaymentTransaction(
                      xmlMakePayment,
                      dataBundle.user_fp,
                      collectionWalletTransactions_logs,
                      resolve
                    );
                  }).then(
                    (result) => {
                      console.log(result);
                      new Promise((resolve) => {
                        deductXML_responses(
                          result,
                          "chargeTokenCreditCard",
                          resolve
                        );
                      }).then(
                        (result) => {
                          if (result !== false) {
                            try {
                              result = JSON.parse(result);
                              console.log(result);
                              if (
                                result.API3G.Result === "000" ||
                                result.API3G.Result == "000"
                              ) {
                                //SUCCESS
                                //Update topup success mongo log
                                new Promise((resolve) => {
                                  saveLogForTopupsSuccess(
                                    dataBundle.user_fp,
                                    dataBundle.amount,
                                    transactionToken,
                                    transRef,
                                    collectionPassengers_profiles,
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

                                //Update mongo rider profile
                                new Promise((resolve) => {
                                  saveLogForTopupsSuccess(
                                    dataBundle.user_fp,
                                    dataBundle.amount,
                                    transactionToken,
                                    transRef,
                                    collectionPassengers_profiles,
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
                                //...
                                //DONE - SUCCESSFULLY PAID
                                res.send({ response: "success" });
                              }
                            } catch (error) {
                              res.send({
                                response: false,
                                message: "payment_error",
                              });
                            }
                          } //Error
                          else {
                            res.send({
                              response: false,
                              message: "payment_error",
                            });
                          }
                        },
                        (error) => {
                          console.log(error);
                          res.send({
                            response: false,
                            message: "payment_error",
                          });
                        }
                      );
                    },
                    (error) => {
                      console.log(error);
                      res.send({ response: false, message: "payment_error" });
                    }
                  );
                } //Error transaction could not be create
                else {
                  res.send({ response: false, message: "transaction_error" });
                }
              } catch (error) {
                res.send({ response: false, message: "transaction_error" });
              }
            } //Error
            else {
              res.send({ response: false, message: "transaction_error" });
            }
          },
          (error) => {
            console.log(error);
            res.send({ response: false, message: "token_error" });
          }
        );
      },
      (error) => {
        res.send({ response: false, message: "token_error" });
      }
    );
  });
});

server.listen(process.env.PAYMENT_SERVICE_PORT);
