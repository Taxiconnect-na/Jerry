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
 * VERIFY PAYMENT
 * 000 Transaction Paid
 * 001 Authorized
 * 002 Transaction overpaid/underpaid
 * 007	Pending Split Payment (Part Payment Transactions not fully paid)
 * 801 Request missing company token
 * 802 Company token does not exist
 * 803 No request or error in Request type name
 * 804 Error in XML
 * 900 Transaction not paid yet
 * 901 Transaction declined
 * 902	Data mismatch in one of the fields - field (explanation)
 * 903 The transaction passed the Payment Time Limit
 * 904 Transaction cancelled
 * 950 Request missing transaction level mandatory fields – field (explanation)
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
      } else if (stepProcess === "verifyToken") {
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
            process.env.PAYMENT_CURRENCY,
            "payment_token_creation",
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
 * @param xmlBody: the XML body request for making a payment request.
 * @param user_fp: the rider's fingerprint.
 * @param collectionWalletTransactions_logs: the collection of all the wallet transactions.
 * @param additionalData: any kind of additional data: can be a transaction token (only for exec payment cases)?
 */

function executePaymentTransaction(
  xmlBody,
  user_fp,
  collectionWalletTransactions_logs,
  additionalData = false,
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
            process.env.PAYMENT_CURRENCY,
            "payment_making_exec",
            reslv,
            additionalData
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
 * @func verifyPaymentTransaction
 * Responsible for verifying any transaction made, which are marked as "transaction charged".
 * @param xmlBody: the XML body request for verifying a payment transaction.
 * @param user_fp: the rider's fingerprint.
 * @param collectionWalletTransactions_logs: the collection of all the wallet transactions.
 * @param additionalData: any kind of additional data: can be a transaction token (only for exec payment cases)?
 */

function verifyPaymentTransaction(
  xmlBody,
  user_fp,
  collectionWalletTransactions_logs,
  additionalData = false,
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
            process.env.PAYMENT_CURRENCY,
            "verify_payment_made",
            reslv,
            additionalData //! Transaction token
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
 * @param user_fp: the rider's fingerprint.
 * @param responseBody: the response from any API or major processes.
 * @param responseError: the resulted error from any API or major processes.
 * @param responseStatusCode: the status code resulted from any API or major processes.
 * @param collectionWalletTransactions_logs: the collection of all the wallet transactions.
 * @param payment_currency: the currency considered for this transation.
 * @param log_label: the name of the process step which want some data to be logged.
 * @param additionalData: any kind of additional data: can be a transaction token (only for exec payment cases)?
 * ! Example of log labels: payment_token_creation, payment_making_exec, etc..
 * @param resolve
 */
function saveLogForTopups(
  user_fp,
  responseBody,
  responseError,
  responseStatusCode,
  collectionWalletTransactions_logs,
  payment_currency,
  log_label,
  resolve,
  additionalData = false
) {
  resolveDate();
  let tmpDate = new Date();
  //...
  let dataBundle = {
    user_fingerprint: user_fp,
    log_label: log_label,
    responseBody: responseBody,
    responseError: responseError,
    responseStatusCode: responseStatusCode,
    payment_currency: payment_currency,
    transactionToken: additionalData,
    date_captured: chaineDateUTC,
    timestamp: tmpDate.getTime(),
  };
  collectionWalletTransactions_logs.insertOne(dataBundle, function (err, res) {
    if (err) {
      console.log(err);
      resolve(false);
    }
    resolve(true);
  });
}

/**
 * @func saveLogForTopupsSuccess
 * Update the transaction log with latest successful topup information.
 * @param user_fp: the rider's fingerprint.
 * @param amount: the amount toped up.
 * @param transactionToken: the unique transaction token of the operation.
 * @param transactionRef: the company's reference for this transaction: check the .env for more.
 * @param payment_currency: the currency considered for this transation.
 * @param collectionWalletTransactions_logs: the colletion of all the wallet transactions.
 * ! EXTREMELY IMMPORTANT.
 */
function saveLogForTopupsSuccess(
  user_fp,
  amount,
  transactionToken,
  transactionRef,
  payment_currency,
  collectionWalletTransactions_logs,
  resolve
) {
  resolveDate();
  let tmpDate = new Date();
  //...
  let dataBundle = {
    user_fingerprint: user_fp,
    amount: amount,
    payment_currency: payment_currency,
    transaction_nature: "topup",
    transactionToken: transactionToken,
    transactionRef: transactionRef,
    date_captured: chaineDateUTC,
    timestamp: tmpDate.getTime(),
  };
  //...
  collectionWalletTransactions_logs.insertOne(dataBundle, function (err, res) {
    if (err) {
      console.log("error");
      resolve(false);
    }
    resolve(true);
  });
}

/**
 * @func processExecute_paymentCardWallet_topup
 * Responsible for parsing the create token deducted response and continue the wallet top-up process for the riders.
 * @param dataBundle: the input data received from the rider.
 * @param createToken_deductedResponse: the create token process XML parsed to JSON.
 * @param collectionWalletTransactions_logs: the collection of all the transaction logs.
 * @param collectionPassengers_profiles: the collection of all the riders.
 * @param resolve
 */
function processExecute_paymentCardWallet_topup(
  dataBundle,
  createToken_deductedResponse,
  collectionWalletTransactions_logs,
  collectionPassengers_profiles,
  resolve
) {
  try {
    createToken_deductedResponse = JSON.parse(createToken_deductedResponse);
    if (
      createToken_deductedResponse.API3G.Result === "000" ||
      createToken_deductedResponse.API3G.Result == "000"
    ) {
      console.log("Executing payment");
      let transactionToken = createToken_deductedResponse.API3G.TransToken;
      let transRef = createToken_deductedResponse.API3G.TransRef;
      dataBundle.number = String(dataBundle.number).replace(/ /g, "");
      dataBundle.expiry = String(dataBundle.expiry).replace("/", "");
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
      new Promise((res0) => {
        executePaymentTransaction(
          xmlMakePayment,
          dataBundle.user_fp,
          collectionWalletTransactions_logs,
          transactionToken,
          res0
        );
      }).then(
        (result_paymentExec) => {
          console.log(result_paymentExec);
          new Promise((res1) => {
            deductXML_responses(
              result_paymentExec,
              "chargeTokenCreditCard",
              res1
            );
          }).then(
            (result_paymentExecDeducted) => {
              if (result_paymentExecDeducted !== false) {
                try {
                  result_paymentExecDeducted = JSON.parse(
                    result_paymentExecDeducted
                  );
                  console.log(result_paymentExecDeducted);
                  if (
                    result_paymentExecDeducted.API3G.Result === "000" ||
                    /^000$/i.test(result_paymentExecDeducted.API3G.Result)
                  ) {
                    //SUCCESS
                    //! VERIFY THE TOKEN PAYMENT
                    new Promise((verifyTransaction) => {
                      let xmlVerifyTransaction = `
                        <?xml version="1.0" encoding="utf-8"?>
                        <API3G>
                          <CompanyToken>${process.env.TOKEN_PAYMENT_CP}</CompanyToken>
                          <Request>verifyToken</Request>
                          <TransactionToken>${transactionToken}</TransactionToken>
                        </API3G>
                        `;
                      verifyPaymentTransaction(
                        xmlVerifyTransaction,
                        dataBundle.user_fp,
                        collectionWalletTransactions_logs,
                        transactionToken,
                        verifyTransaction
                      );
                    }).then(
                      (resultVerify_transaction) => {
                        //PARSE VERIFY TRANSACTION RESULTS
                        new Promise((res15) => {
                          deductXML_responses(
                            resultVerify_transaction,
                            "verifyToken",
                            res15
                          );
                        }).then(
                          (result_verifyPaymentDeducted) => {
                            try {
                              result_verifyPaymentDeducted = JSON.parse(
                                result_verifyPaymentDeducted
                              );
                              console.log(result_verifyPaymentDeducted);
                              //! ONLY ALLOW: TRANSACTION PAID (000), AUTHORIZED (001), TRANSACTION NOT PAID YET (900), consider the rest as faild charge.
                              if (
                                /(000|001|900)/i.test(
                                  result_verifyPaymentDeducted.API3G.Result
                                )
                              ) {
                                //Update topup success mongo log
                                new Promise((res2) => {
                                  saveLogForTopupsSuccess(
                                    dataBundle.user_fp,
                                    dataBundle.amount,
                                    transactionToken,
                                    transRef,
                                    process.env.PAYMENT_CURRENCY,
                                    collectionWalletTransactions_logs,
                                    res2
                                  );
                                }).then(
                                  () => {},
                                  () => {}
                                );
                                //...
                                //DONE - SUCCESSFULLY PAID
                                resolve({ response: "success" });
                              } //Creddit card charging failed
                              else {
                                resolve({
                                  response: false,
                                  message: "payment_error",
                                });
                              }
                            } catch (error) {
                              console.log(error);
                              esolve({
                                response: false,
                                message: "payment_error",
                              });
                            }
                          },
                          (error) => {
                            console.log(error);
                            resolve({
                              response: false,
                              message: "payment_error",
                            });
                          }
                        );
                      },
                      (error) => {
                        console.log(error);
                        resolve({
                          response: false,
                          message: "payment_error",
                        });
                      }
                    );
                  }
                } catch (error) {
                  resolve({
                    response: false,
                    message: "payment_error",
                  });
                }
              } //Error
              else {
                resolve({
                  response: false,
                  message: "payment_error",
                });
              }
            },
            (error) => {
              console.log(error);
              resolve({
                response: false,
                message: "payment_error",
              });
            }
          );
        },
        (error) => {
          console.log(error);
          resolve({ response: false, message: "payment_error" });
        }
      );
    } //Error transaction could not be create
    else {
      resolve({ response: false, message: "transaction_error" });
    }
  } catch (error) {
    console.log(error);
    resolve({ response: false, message: "transaction_error" });
  }
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
      user_fp:
        "7c57cb6c9471fd33fd265d5441f253eced2a6307c0207dea57c987035b496e6e8dfa7105b86915da",
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
      <PaymentCurrency>${process.env.PAYMENT_CURRENCY}</PaymentCurrency>
      <CompanyRef>${process.env.COMPANY_DPO_REF}</CompanyRef>
      <RedirectURL>${process.env.REDIRECT_URL_AFTER_PROCESSES}</RedirectURL>
      <BackURL>${process.env.REDIRECT_URL_AFTER_PROCESSES}</BackURL>
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
          (result_createTokenDeducted) => {
            console.log(result_createTokenDeducted);
            if (result_createTokenDeducted !== false) {
              //? Continue the top-up process
              new Promise((resFollower) => {
                processExecute_paymentCardWallet_topup(
                  dataBundle,
                  result_createTokenDeducted,
                  collectionWalletTransactions_logs,
                  collectionPassengers_profiles,
                  resFollower
                );
              }).then(
                (result_final) => {
                  res.send(result_final);
                },
                (error) => {
                  console.log(error);
                  res.send({ response: false, message: "transaction_error" });
                }
              );
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
