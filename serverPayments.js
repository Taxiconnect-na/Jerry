require("dotenv").config();
//require("newrelic");
var express = require("express");
const http = require("http");
const fs = require("fs");
const MongoClient = require("mongodb").MongoClient;
const certFile = fs.readFileSync("./rds-combined-ca-bundle.pem");
const nodemailer = require("nodemailer");
var parser = require("xml2json");

const { logger } = require("./LogService");

var app = express();
var server = http.createServer(app);
const requestAPI = require("request");
//....
const crypto = require("crypto");
//...

const urlParser = require("url");
var chaineDateUTC = null;
var dateObject = null;
var dateObjectImute = null;
const moment = require("moment");

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
  chaineDateUTC = new Date(date).toISOString();
}
resolveDate();

let transporterSecurity = nodemailer.createTransport({
  host: process.env.INOUT_GOING_SERVER,
  port: process.env.LOGIN_EMAIL_SMTP,
  secure: true, // true for 465, false for other ports
  auth: {
    user: process.env.LOGIN_EMAIL_USER, // generated ethereal user
    pass: process.env.LOGIN_EMAIL_PASSWORD, // generated ethereal password
  },
});

let transporterNoReplay = nodemailer.createTransport({
  host: process.env.INOUT_GOING_SERVER,
  port: process.env.LOGIN_EMAIL_SMTP,
  secure: true, // true for 465, false for other ports
  auth: {
    user: process.env.NOREPLY_EMAIL, // generated ethereal user
    pass: process.env.NOREPLY_EMAIL_PASSWORD, // generated ethereal password
  },
});

/**
 * @func generateUniqueFingerprint()
 * Generate unique fingerprint for any string size.
 */
function generateUniqueFingerprint(str, encryption = false, resolve) {
  str = str.trim();
  let fingerprint = null;
  if (encryption === false) {
    fingerprint = crypto
      .createHmac(
        "sha512WithRSAEncryption",
        "TAXICONNECTBASICKEYFINGERPRINTS-RIDES-DELIVERY"
      )
      .update(str)
      .digest("hex");
    resolve(fingerprint);
  } else if (/md5/i.test(encryption)) {
    fingerprint = crypto
      .createHmac(
        "md5WithRSAEncryption",
        "TAXICONNECTBASICKEYFINGERPRINTS-RIDES-DELIVERY"
      )
      .update(str)
      .digest("hex");
    resolve(fingerprint);
  } //Other - default
  else {
    fingerprint = crypto
      .createHmac("sha256", "TAXICONNECTBASICKEYFINGERPRINTS-RIDES-DELIVERY")
      .update(str)
      .digest("hex");
    resolve(fingerprint);
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
    logger.info("Error");
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
    date_captured: new Date(chaineDateUTC),
    timestamp: tmpDate.getTime(),
  };
  collectionWalletTransactions_logs.insertOne(dataBundle, function (err, res) {
    if (err) {
      logger.info(err);
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
 * @param trailingData: any other additional data needed
 * ! EXTREMELY IMMPORTANT.
 */
function saveLogForTopupsSuccess(
  user_fp,
  amount,
  transactionToken,
  transactionRef,
  payment_currency,
  collectionWalletTransactions_logs,
  resolve,
  trailingData = false
) {
  resolveDate();
  let tmpDate = new Date();
  let dpo_gateway_deduction_fees =
    (parseFloat(amount) * process.env.DPO_GATEWAY_CHARGES_PERCENTAGE) / 100;
  let taxiconnect_service_fees =
    (parseFloat(amount) * process.env.TAXICONNECT_WALLET_TOPUP_SERVICE_FEES) /
    100;
  let amountRecomputed =
    parseFloat(amount) - dpo_gateway_deduction_fees - taxiconnect_service_fees; //! VERY IMPORTANT - REMOVE DPO AND TAXICONNECT DEDUCTIONS
  //...

  if (
    /normal/i.test(trailingData.request_globality) ||
    trailingData.request_globality === undefined
  ) {
    let dataBundle = {
      user_fingerprint: user_fp,
      initial_paid_amount: parseFloat(amount),
      dpo_gateway_deduction_fees: dpo_gateway_deduction_fees,
      taxiconnect_service_fees: taxiconnect_service_fees,
      amount: Math.floor((amountRecomputed + Number.EPSILON) * 100) / 100,
      payment_currency: payment_currency,
      transaction_nature: "topup",
      transactionToken: transactionToken,
      transactionRef: transactionRef,
      date_captured: new Date(chaineDateUTC),
      timestamp: tmpDate.getTime(),
    };
    //...
    collectionWalletTransactions_logs.insertOne(
      dataBundle,
      function (err, res) {
        if (err) {
          logger.info("error");
          resolve(false);
        }
        resolve(true);
      }
    );
  } //!Corporate globality
  else {
    const PLAN_CODES = {
      Starter: "STR",
      Intermediate: "ITMD",
      Pro: "PR",
      Personalised: "PRSNLD",
    };
    //...
    let dataBundle = {
      company_fp: user_fp,
      plan_name: trailingData.plan_name,
      plan_code: PLAN_CODES[trailingData.plan_name],
      initial_paid_amount: parseFloat(amount),
      dpo_gateway_deduction_fees: dpo_gateway_deduction_fees,
      taxiconnect_service_fees: taxiconnect_service_fees,
      amount: Math.floor((amountRecomputed + Number.EPSILON) * 100) / 100,
      payment_currency: payment_currency,
      transaction_nature: "topups-corporate",
      transactionToken: transactionToken,
      transaction_fp: transactionToken,
      transactionRef: transactionRef,
      date_captured: new Date(chaineDateUTC),
      timestamp: tmpDate.getTime(),
    };
    //...
    collectionWalletTransactions_logs.insertOne(
      dataBundle,
      function (err, res) {
        if (err) {
          logger.info("error");
          resolve(false);
        }
        //!Update the the corporate profile with the new plan details
        //! ONLY USE THE PLAN CODE
        collectionDedicatedServices_accounts.updateOne(
          { company_fp: user_fp },
          {
            $set: {
              "plans.subscribed_plan": PLAN_CODES[trailingData.plan_name],
              "plans.isPlan_active": true,
            },
          },
          function (err, res) {
            if (err) {
              logger.info("error");
              resolve(false);
            }
            resolve(true);
          }
        );
      }
    );
  }
}

/**
 * @func processExecute_paymentCardWallet_topup
 * Responsible for parsing the create token deducted response and continue the wallet top-up process for the riders.
 * @param dataBundle: the input data received from the rider.
 * @param createToken_deductedResponse: the create token process XML parsed to JSON.
 * @param collectionWalletTransactions_logs: the collection of all the transaction logs.
 * @param collectionPassengers_profiles: the collection of all the riders.
 * @param collectionGlobalEvents: the collection of all the events
 * @param resolve
 */
function processExecute_paymentCardWallet_topup(
  dataBundle,
  createToken_deductedResponse,
  collectionWalletTransactions_logs,
  collectionPassengers_profiles,
  collectionGlobalEvents,
  resolve
) {
  try {
    createToken_deductedResponse = JSON.parse(createToken_deductedResponse);
    if (
      createToken_deductedResponse.API3G.Result === "000" ||
      createToken_deductedResponse.API3G.Result == "000"
    ) {
      logger.info("Executing payment");
      let transactionToken = createToken_deductedResponse.API3G.TransToken;
      let transRef = createToken_deductedResponse.API3G.TransRef;
      dataBundle.number = String(dataBundle.number).replace(/ /g, "");
      dataBundle.expiry = String(dataBundle.expiry).replace("/", "");
      //DEBUG CARD -------------------------------------------------------------------------------
      if (
        /^enabled/i.test(process.env.DEV_DELIVERY_STATE) &&
        /corporate/i.test(dataBundle.request_globality)
      ) {
        dataBundle.number = "5436886269848367";
        dataBundle.expiry = "1222";
        dataBundle.cvv = "123";
      }
      // -----------------------------------------------------------------------------------------
      logger.warn(dataBundle);

      //...
      //MAKE PAYMENT
      //? XML TOKEN responsible for making the payment.
      let xmlMakePayment = `
          <?xml version="1.0" encoding="utf-8"?>
          <API3G>
            <CompanyToken>${
              /^enabled/i.test(process.env.DEV_DELIVERY_STATE) &&
              /corporate/i.test(dataBundle.request_globality)
                ? process.env.DEV_TOKEN_PAYMENT_CP
                : process.env.TOKEN_PAYMENT_CP
            }</CompanyToken>
            <Request>chargeTokenCreditCard</Request>
            <TransactionToken>${transactionToken}</TransactionToken>
            <CreditCardNumber>${dataBundle.number}</CreditCardNumber>
            <CreditCardExpiry>${dataBundle.expiry}</CreditCardExpiry>
            <CreditCardCVV>${dataBundle.cvv}</CreditCardCVV>
            <CardHolderName>${dataBundle.name}</CardHolderName>
            <ChargeType></ChargeType>
          </API3G>
          `;

      logger.info(xmlMakePayment);
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
          logger.warn(result_paymentExec);
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
                          <CompanyToken>${
                            /^enabled/i.test(process.env.DEV_DELIVERY_STATE) &&
                            /corporate/i.test(dataBundle.request_globality)
                              ? process.env.DEV_TOKEN_PAYMENT_CP
                              : process.env.TOKEN_PAYMENT_CP
                          }</CompanyToken>
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
                                    res2,
                                    dataBundle
                                  );
                                }).then(
                                  () => {},
                                  () => {}
                                );
                                //...
                                //Send the receipt for the delivery web purchases of packages
                                new Promise((resSendReceipt) => {
                                  if (
                                    /corporate/i.test(
                                      dataBundle.request_globality
                                    )
                                  ) {
                                    sendReceipt(
                                      dataBundle,
                                      "packagePurchaseReceipt",
                                      resSendReceipt
                                    );
                                  } //Pass
                                  else {
                                    resSendReceipt(false);
                                  }
                                })
                                  .then()
                                  .catch((error) => logger.error(error));

                                //DONE - SUCCESSFULLY PAID
                                resolve({
                                  response: "success",
                                });
                              } //Creddit card charging failed
                              else {
                                resolve({
                                  response: false,
                                  message: "payment_error",
                                });
                              }
                            } catch (error) {
                              logger.info(error);
                              esolve({
                                response: false,
                                message: "payment_error",
                              });
                            }
                          },
                          (error) => {
                            logger.info(error);
                            resolve({
                              response: false,
                              message: "payment_error",
                            });
                          }
                        );
                      },
                      (error) => {
                        logger.info(error);
                        resolve({
                          response: false,
                          message: "payment_error",
                        });
                      }
                    );
                  } //!ERROR - SAVE LOG
                  else {
                    new Promise((resFailedTransaction) => {
                      let faildTransObj = {
                        event_name: "Failed_top_up_creddit_card_transaction",
                        user_fingerprint: dataBundle.user_fp,
                        transactionToken: transactionToken,
                        amount: dataBundle.amount,
                        transactionRef: transRef,
                        responseBody: result_paymentExecDeducted,
                        date_captured: new Date(chaineDateUTC),
                      };
                      //...
                      collectionGlobalEvents.insertOne(
                        faildTransObj,
                        function (err, resltx) {
                          resFailedTransaction(true);
                        }
                      );
                    }).then(
                      () => {},
                      () => {}
                    );
                    //Done
                    resolve({
                      response: false,
                      message:
                        result_paymentExecDeducted.API3G.ResultExplanation !==
                        undefined
                          ? result_paymentExecDeducted.API3G.ResultExplanation.split(
                              "-"
                            )[0] !== undefined
                            ? result_paymentExecDeducted.API3G.ResultExplanation.split(
                                "-"
                              )[0].trim()
                            : "payment_error"
                          : "payment_error",
                    });
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
              logger.info(error);
              resolve({
                response: false,
                message: "payment_error",
              });
            }
          );
        },
        (error) => {
          logger.info(error);
          resolve({ response: false, message: "payment_error" });
        }
      );
    } //Error transaction could not be create
    else {
      resolve({ response: false, message: "transaction_error" });
    }
  } catch (error) {
    logger.info(error);
    resolve({ response: false, message: "transaction_error" });
  }
}

/**
 * @func checkReceipient_walletTransaction
 * Responsible for executing the checking the details of the receipient during a wallet transaction,
 * ? can only send to active Taxiconnect riders/drivers.
 * ? User nature: friend or driver ONLY
 * @param dataBundle: the receiver's phone number (friend) or payment number (drivers)
 * @param collectionPassengers_profiles: the collection of all the riders.
 * @param collectionDrivers_profiles: the collection of all the drivers.
 * @param collectionGlobalEvents: the collection of all the events
 * @param resolve
 * @param includeReceipient_fp: the indicate if the fingerprint should be added or not. - default: false
 *
 * ! If valid user, get the name only.
 */
function checkReceipient_walletTransaction(
  dataBundle,
  collectionPassengers_profiles,
  collectionDrivers_profiles,
  collectionGlobalEvents,
  resolve,
  includeReceipient_fp = false
) {
  resolveDate();
  //...
  if (/friend/i.test(dataBundle.user_nature)) {
    //To friends/family - check the phone number
    let phoneWithoutPlusSigne = dataBundle.payNumberOrPhoneNumber
      .replace("+", "")
      .trim(); //? Critical, should only contain digits
    let regFiler = {
      phone_number: `+${dataBundle.payNumberOrPhoneNumber.trim()}`,
    };
    //...
    collectionPassengers_profiles
      .find(regFiler)
      .toArray(function (err, riderProfile) {
        if (err) {
          resolve({ response: "error", flag: "transaction_error" });
        }
        //...
        if (
          riderProfile.length > 0 &&
          riderProfile[0].user_fingerprint !== undefined &&
          riderProfile[0].user_fingerprint !== null
        ) {
          //Found the receipient
          new Promise((resEventSave) => {
            //Save the event
            let eventSaverObj = {
              event_name: "checking_receipient_walletTransaction",
              receipient_category: "friendOrFamily",
              user_fingerprint: dataBundle.user_fingerprint,
              receiver_fingerprint: riderProfile[0].user_fingerprint,
              date_captured: new Date(chaineDateUTC),
            };
            //...
            collectionGlobalEvents.insertOne(
              eventSaverObj,
              function (err, reslt) {
                resEventSave(true);
              }
            );
          }).then(
            () => {},
            () => {}
          );
          //...DONE
          resolve({
            response: "verified",
            user_nature: "friend",
            receipient_name: riderProfile[0].name,
            recipient_fp: includeReceipient_fp
              ? riderProfile[0].user_fingerprint
              : null,
          });
        } //Strange - no active account foundd
        else {
          resolve({
            response: "error",
            flag: "transaction_error_unregistered",
          });
        }
      });
  } else if (/driver/i.test(dataBundle.user_nature)) {
    //To drivers
    let regFiler = {
      "identification_data.paymentNumber": parseInt(
        dataBundle.payNumberOrPhoneNumber
      ),
    };
    //...
    collectionDrivers_profiles
      .find(regFiler)
      .toArray(function (err, driverProfile) {
        if (err) {
          resolve({ response: "error", flag: "transaction_error" });
        }
        //...
        if (
          driverProfile.length !== undefined &&
          driverProfile.length > 0 &&
          driverProfile[0].driver_fingerprint !== undefined &&
          driverProfile[0].driver_fingerprint !== null
        ) {
          //Found the receipient
          new Promise((resEventSave) => {
            //Save the event
            let eventSaverObj = {
              event_name: "checking_receipient_walletTransaction",
              receipient_category: "driver",
              user_fingerprint: dataBundle.user_fingerprint,
              receiver_fingerprint: driverProfile[0].driver_fingerprint,
              date_captured: new Date(chaineDateUTC),
            };
            //...
            collectionGlobalEvents.insertOne(
              eventSaverObj,
              function (err, reslt) {
                resEventSave(true);
              }
            );
          }).then(
            () => {},
            () => {}
          );
          //...DONE
          resolve({
            response: "verified",
            user_nature: "driver",
            receipient_name: driverProfile[0].name,
            recipient_fp: includeReceipient_fp
              ? driverProfile[0].driver_fingerprint
              : null,
          });
        } //? Check for a potential taxi number reference
        else {
          let regFiler = {
            "cars_data.taxi_number":
              dataBundle.payNumberOrPhoneNumber.toUpperCase(),
          };
          logger.warn(regFiler);
          //...
          collectionDrivers_profiles
            .find(regFiler)
            .toArray(function (err, driverProfile) {
              if (err) {
                resolve({ response: "error", flag: "transaction_error" });
              }
              //...
              if (
                driverProfile.length !== undefined &&
                driverProfile.length > 0 &&
                driverProfile[0].driver_fingerprint !== undefined &&
                driverProfile[0].driver_fingerprint !== null
              ) {
                //Found the receipient
                new Promise((resEventSave) => {
                  //Save the event
                  let eventSaverObj = {
                    event_name: "checking_receipient_walletTransaction",
                    receipient_category: "driver",
                    user_fingerprint: dataBundle.user_fingerprint,
                    receiver_fingerprint: driverProfile[0].driver_fingerprint,
                    date_captured: new Date(chaineDateUTC),
                  };
                  //...
                  collectionGlobalEvents.insertOne(
                    eventSaverObj,
                    function (err, reslt) {
                      resEventSave(true);
                    }
                  );
                }).then(
                  () => {},
                  () => {}
                );
                //...DONE
                resolve({
                  response: "verified",
                  user_nature: "driver",
                  receipient_name: driverProfile[0].name,
                  recipient_fp: includeReceipient_fp
                    ? driverProfile[0].driver_fingerprint
                    : null,
                });
              } //! Strange - no active account foundd
              else {
                resolve({
                  response: "error",
                  flag: "transaction_error_unregistered",
                });
              }
            });
        }
      });
  }
}

/**
 * @func execSendMoney_fromRiderWallet_transaction
 * Responsible for executing the payment from the rider's wallet to diverse recipients.
 * ? Friend/Family or drivers.
 * @param dataBundle: the general transaction details : amount, recipient fingerprint, sender fingerprint.
 * @param collectionWalletTransactions_logs: all the transactions that happened.
 * @param resolve
 */
function execSendMoney_fromRiderWallet_transaction(
  dataBundle,
  collectionWalletTransactions_logs,
  resolve
) {
  let dateTmp = new Date();
  if (/friend/i.test(dataBundle.user_nature)) {
    //Friend/family
    let transaction_obj = {
      user_fingerprint: dataBundle.user_fingerprint,
      recipient_fp: dataBundle.recipient_fp,
      amount: parseFloat(dataBundle.amount),
      payment_currency: process.env.PAYMENT_CURRENCY,
      transaction_nature: "sentToFriend",
      date_captured: new Date(chaineDateUTC),
      timestamp: dateTmp.getTime(),
    };
    //...
    collectionWalletTransactions_logs.insertOne(
      transaction_obj,
      function (err, result) {
        if (err) {
          resolve({ response: "error", flag: "transaction_error" });
        }
        //? NOTIFY THE RECEIVER
        //Send the push notifications
        /*let message = {
          app_id: process.env.RIDERS_APP_ID_ONESIGNAL,
          android_channel_id:
            process.env
              .RIDERS_ONESIGNAL_CHANNEL_ACCEPTTEDD_REQUEST, //Wallet transaction
          priority: 10,
          contents: {
            en:
              "Your wallet ",
          },
          headings: { en: "Unable to find a ride" },
          content_available: true,
          include_player_ids: [
            recordData.pushNotif_token,
          ],
        };
        //Send
        sendPushUPNotification(message);*/
        //...
        resolve({
          response: "successful",
          amount: dataBundle.amount,
          payment_currency: process.env.PAYMENT_CURRENCY,
        });
      }
    );
  } else if (/driver/i.test(dataBundle.user_nature)) {
    //Driver
    let transaction_obj = {
      user_fingerprint: dataBundle.user_fingerprint,
      recipient_fp: dataBundle.recipient_fp,
      amount: parseFloat(dataBundle.amount),
      payment_currency: process.env.PAYMENT_CURRENCY,
      transaction_nature: "paidDriver",
      date_captured: new Date(chaineDateUTC),
      timestamp: dateTmp.getTime(),
    };
    //...
    collectionWalletTransactions_logs.insertOne(
      transaction_obj,
      function (err, result) {
        if (err) {
          resolve({ response: "error", flag: "transaction_error" });
        }
        //...
        resolve({
          response: "successful",
          amount: dataBundle.amount,
          payment_currency: process.env.PAYMENT_CURRENCY,
        });
      }
    );
  }
}

/**
 * @func checkNonSelf_sendingFunds_user
 * Responsible for checcking that the sender of the funds is not the receiver.
 * @param collectionPassengers_profiles: the list of all the passengers.
 * @param payNumberOrPhoneNumber: the sender's phone number
 * @param user_nature: the nature of the user (friend/driver)
 * @param sender_fingerprint: the fingerprint of the sender
 * @param resolve
 */
function checkNonSelf_sendingFunds_user(
  collectionPassengers_profiles,
  payNumberOrPhoneNumber,
  user_nature,
  sender_fingerprint,
  resolve
) {
  if (/friend/i.test(user_nature)) {
    //To friend - check
    collectionPassengers_profiles
      .find({
        phone_number: payNumberOrPhoneNumber.trim(),
      })
      .toArray(function (err, senderDetails) {
        if (err) {
          resolve({ response: false, flag: "invalid_sender" });
        }
        //...
        if (
          senderDetails.length > 0 &&
          senderDetails[0].user_fingerprint !== undefined &&
          senderDetails[0].user_fingerprint !== null &&
          senderDetails[0].user_fingerprint === sender_fingerprint
        ) {
          //Found a sender
          //! SAME SENDER - INVALID
          resolve({ response: false, flag: "invalid_sender" });
        } //? Found a valid sender
        else {
          resolve({ response: true, flag: "valid_sender" });
        }
      });
  } //TO any other nature - pass
  else {
    resolve({ response: true, flag: "valid_sender" });
  }
}

/**
 * @func sendReceipt
 * Responsible for sending receipts for delivery web requests.
 * @param metaDataBundle: the drop off meta data
 * @param scenarioType: dropoffReceipt or packagePurchaseReceipt
 * @param resolve
 */
function sendReceipt(metaDataBundle, scenarioType, resolve) {
  logger.info(metaDataBundle);
  logger.info(scenarioType);
  resolveDate();

  if (/packagePurchaseReceipt/i.test(scenarioType)) {
    //Receipt after purchasing a package
    let dpo_gateway_deduction_fees =
      (parseFloat(metaDataBundle.amount) *
        process.env.DPO_GATEWAY_CHARGES_PERCENTAGE) /
      100;
    let taxiconnect_service_fees =
      (parseFloat(metaDataBundle.amount) *
        process.env.TAXICONNECT_WALLET_TOPUP_SERVICE_FEES) /
      100;
    let amountRecomputed =
      parseFloat(metaDataBundle.amount) -
      dpo_gateway_deduction_fees -
      taxiconnect_service_fees; //! VERY IMPORTANT - REMOVE DPO AND TAXICONNECT DEDUCTIONS
    //...
    //Get the company data
    collectionDedicatedServices_accounts
      .find({
        company_fp: metaDataBundle.user_fp,
      })
      .toArray(function (err, companyData) {
        if (err) {
          logger.error(err);
          resolve(false);
        }
        logger.info(companyData);
        //...
        if (companyData !== undefined && companyData.length > 0) {
          companyData = companyData[0];
          let receiptFp = Math.round(new Date(chaineDateUTC).getTime())
            .toString()
            .substring(0, 7);
          //Found the company
          //? Generate a receipt fingerprint
          new Promise((resGenerateFp) => {
            generateUniqueFingerprint(
              `${metaDataBundle.user_fp}-${new Date(chaineDateUTC).getTime()}`,
              "md5",
              resGenerateFp
            );
          })
            .then((result) => {
              receiptFp = result.toString().toUpperCase().substring(0, 7);
            })
            .catch((error) => {
              logger.error(error);
              //...
            })
            .finally(() => {
              let emailTemplate = `
              <!doctype html>
              <html>

              <head>
                <meta charset="utf-8">
                <meta http-equiv="x-ua-compatible" content="ie=edge">
                <title></title>
                <meta name="description" content="">
                <meta name="viewport" content="width=device-width, initial-scale=1">


                <style type="text/css">
                  a {
                    color: #0000ee;
                    text-decoration: underline;
                  }
                  
                  a:hover {
                    color: #0000ee;
                    text-decoration: underline;
                  }
                  
                  .u-row {
                    display: flex;
                    flex-wrap: nowrap;
                    margin-left: 0;
                    margin-right: 0;
                  }
                  
                  .u-row .u-col {
                    position: relative;
                    width: 100%;
                    padding-right: 0;
                    padding-left: 0;
                  }
                  
                  .u-row .u-col.u-col-100 {
                    flex: 0 0 100%;
                    max-width: 100%;
                  }
                  
                  @media (max-width: 767px) {
                    .u-row:not(.no-stack) {
                      flex-wrap: wrap;
                    }
                    .u-row:not(.no-stack) .u-col {
                      flex: 0 0 100% !important;
                      max-width: 100% !important;
                    }
                  }
                  
                  body,
                  html {
                    padding: 0;
                    margin: 0;background-color:#fff;
                  }
                  
                  html {
                    box-sizing: border-box
                  }
                  
                  *,
                  :after,
                  :before {
                    box-sizing: inherit
                  }
                  
                  html {
                    font-size: 14px;
                    -ms-overflow-style: scrollbar;
                    -webkit-tap-highlight-color: rgba(0, 0, 0, 0)
                  }
                  
                  body {
                    font-family: Arial, Helvetica, sans-serif;
                    font-size: 1rem;
                    line-height: 1.5;
                    color: #373a3c;
                    background-color: #fff
                  }
                  
                  p {
                    margin: 0
                  }
                  
                  .error-field {
                    -webkit-animation-name: shake;
                    animation-name: shake;
                    -webkit-animation-duration: 1s;
                    animation-duration: 1s;
                    -webkit-animation-fill-mode: both;
                    animation-fill-mode: both
                  }
                  
                  .error-field input,
                  .error-field textarea {
                    border-color: #a94442!important;
                    color: #a94442!important
                  }
                  
                  .field-error {
                    padding: 5px 10px;
                    font-size: 14px;
                    font-weight: 700;
                    position: absolute;
                    top: -20px;
                    right: 10px
                  }
                  
                  .field-error:after {
                    top: 100%;
                    left: 50%;
                    border: solid transparent;
                    content: " ";
                    height: 0;
                    width: 0;
                    position: absolute;
                    pointer-events: none;
                    border-color: rgba(136, 183, 213, 0);
                    border-top-color: #ebcccc;
                    border-width: 5px;
                    margin-left: -5px
                  }
                  
                  .spinner {
                    margin: 0 auto;
                    width: 70px;
                    text-align: center
                  }
                  
                  .spinner>div {
                    width: 12px;
                    height: 12px;
                    background-color: hsla(0, 0%, 100%, .5);
                    margin: 0 2px;
                    border-radius: 100%;
                    display: inline-block;
                    -webkit-animation: sk-bouncedelay 1.4s infinite ease-in-out both;
                    animation: sk-bouncedelay 1.4s infinite ease-in-out both
                  }
                  
                  .spinner .bounce1 {
                    -webkit-animation-delay: -.32s;
                    animation-delay: -.32s
                  }
                  
                  .spinner .bounce2 {
                    -webkit-animation-delay: -.16s;
                    animation-delay: -.16s
                  }
                  
                  @-webkit-keyframes sk-bouncedelay {
                    0%,
                    80%,
                    to {
                      -webkit-transform: scale(0)
                    }
                    40% {
                      -webkit-transform: scale(1)
                    }
                  }
                  
                  @keyframes sk-bouncedelay {
                    0%,
                    80%,
                    to {
                      -webkit-transform: scale(0);
                      transform: scale(0)
                    }
                    40% {
                      -webkit-transform: scale(1);
                      transform: scale(1)
                    }
                  }
                  
                  @-webkit-keyframes shake {
                    0%,
                    to {
                      -webkit-transform: translateZ(0);
                      transform: translateZ(0)
                    }
                    10%,
                    30%,
                    50%,
                    70%,
                    90% {
                      -webkit-transform: translate3d(-10px, 0, 0);
                      transform: translate3d(-10px, 0, 0)
                    }
                    20%,
                    40%,
                    60%,
                    80% {
                      -webkit-transform: translate3d(10px, 0, 0);
                      transform: translate3d(10px, 0, 0)
                    }
                  }
                  
                  @keyframes shake {
                    0%,
                    to {
                      -webkit-transform: translateZ(0);
                      transform: translateZ(0)
                    }
                    10%,
                    30%,
                    50%,
                    70%,
                    90% {
                      -webkit-transform: translate3d(-10px, 0, 0);
                      transform: translate3d(-10px, 0, 0)
                    }
                    20%,
                    40%,
                    60%,
                    80% {
                      -webkit-transform: translate3d(10px, 0, 0);
                      transform: translate3d(10px, 0, 0)
                    }
                  }
                  
                  @media only screen and (max-width:480px) {
                    .container {
                      max-width: 100%!important
                    }
                  }
                  
                  .container {
                    width: 100%;
                    padding-right: 0;
                    padding-left: 0;
                    margin-right: auto;
                    margin-left: auto
                  }
                  
                  
                  
                  a[onclick] {
                    cursor: pointer;
                  }
                </style>


              </head>

              <body style="background-color:#fff;">

                <div id="u_body" class="u_body" style="min-height: 100vh; color: #000000; background-color: #fff; font-family: arial,helvetica,sans-serif;">

                  <div id="u_row_1" class="u_row" style="padding: 0px;">
                    <div class="container" style="width:100%;margin: 0 auto;">
                      <div class="u-row">

                        <div id="u_column_1" class="u-col u-col-100 u_column">
                          <div style="padding: 0px;border-top: 0px solid transparent;border-left: 0px solid transparent;border-right: 0px solid transparent;border-bottom: 0px solid transparent;">

                            <div id="u_content_html_1" class="u_content_html" style="overflow-wrap: break-word;padding: 10px;">
                            <div class="u-col u_column style="display: flex;flex-direction: column;align-items: flex-start;justify-content: center;padding:20px;padding-left:5%;padding-right:5%;font-family:Arial, Helvetica, sans-serif;font-size: 15px;flex:1;width:100%">
                            <div style="width: 100px;height:100px;bottom:20px;position: relative;margin:auto">
                                <img alt="TaxiConnect" src="https://ads-central-tc.s3.us-west-1.amazonaws.com/logo_ios.png" style="width: 100%;height: 100%;object-fit: contain;" />
                            </div>
                            <div style="border-bottom:1px solid #d0d0d0;display: flex;flex-direction: row;justify-content: space-between;margin-bottom: 15px;width: 100%;">
                                <div style="display: flex;flex-direction: row;">
                                    <div style="margin-left: 2%;">
                                        <div style="font-weight: bold;font-size: 17px;">Posterity TaxiConnect Technologies CC</div>
                                        <div style="font-size: 14px;margin-top: 5px;color:#272626bb">
                                        <div>17 Schinz street</div>
                                        <div>Windhoek</div>
                                        <div>+264814400089</div>
                                        <div>support@taxiconnectna.com</div>
                                        </div>
                                    </div>
                                </div>
                                <div style="text-align: right;width:100%">
                                    <div style="margin-bottom: 13px;">
                                        <div style="font-weight: bold;font-size: 11px;">RECEIPT</div>
                                        <div style="font-size: 14px;color:#272626bb;margin-top: 4px;">${receiptFp}</div>
                                    </div>
                                    <div style="margin-bottom: 13px;">
                                        <div style="font-weight: bold;font-size: 11px;">DATE</div>
                                        <div style="font-size: 14px;color:#272626bb;margin-top: 4px;">${
                                          new Date(chaineDateUTC)
                                            .toDateString()
                                            .split(" ")[1]
                                        } ${new Date(
                chaineDateUTC
              ).getDate()}, ${new Date(chaineDateUTC).getFullYear()}</div>
                                    </div>
                                    <div style="margin-bottom: 25px;min-width: 100px;">
                                        <div style="font-weight: bold;font-size: 11px;">BALANCE DUE</div>
                                        <div style="font-size: 14px;color:#272626bb;margin-top: 4px;">NAD $${parseFloat(
                                          metaDataBundle.amount
                                        ).toFixed(2)}</div>
                                    </div>
                                </div>
                            </div>
                        
                            <div style="border:1px solid #fff;margin-top: 10px;width:100%">
                                <div  style="font-size: 11px;margin-top: 5px;color:#272626bb">BILL TO</div>
                                <div  style="font-weight: bold;font-size: 17px;margin-top: 10px;margin-bottom: 20px;">${companyData.company_name.toUpperCase()}</div>
                                <div style="font-size: 14px;margin-top: 5px;color:#272626bb;line-height: 20px;">
                                    <div>Windhoek</div>
                                    <div>${companyData.phone}</div>
                                    </div>
                            </div>
                        
                            <div style="border-top:1px solid #272626bb;border-bottom:1px solid #272626bb; display: flex;flex-direction: row;color:#000;padding-bottom: 10px;padding-top:10px;margin-top: 40px;width:100%">
                                <div style="flex:1;align-items: flex-end;font-weight: bold;font-size: 12px;width:50%;">DESCRIPTION</div>
                                <div style="display: flex;flex-direction: row;text-align: right;font-size: 12px;font-weight: bold;flex:1;justify-content: space-between;width:50%">
                                    <div style="flex:1;width:33%;">RATE</div>
                                    <div style="flex:1;width:33%">QTY</div>
                                    <div style="flex:1;width:33%">AMOUNT</div>
                                </div>
                            </div>

                            <div style="border-bottom:1px dashed #272626bb; display: flex;flex-direction: row;color:#000;padding-bottom: 10px;padding-top:10px;margin-top: 10px;width:100%">
                                <div style="flex:1;width:50%;">
                                <div style="align-items: flex-end;font-weight: bold;font-size: 15px;margin-bottom: 5px;">${
                                  metaDataBundle.plan_name
                                }</div>
                                <div style="color: #272626bb;font-size: 13px;">
                                    Package purchased
                                </div>
                                </div>
                                <div style="display: flex;flex-direction: row;text-align: right;font-size: 14px;color:#272626bb;flex:1;justify-content: space-between;width:50%">
                                    <div style="flex:1;width:33%;">$${parseFloat(
                                      metaDataBundle.amount
                                    ).toFixed(2)}</div>
                                    <div style="flex:1;width:33%;">1</div>
                                    <div style="flex:1;width:33%;">$${parseFloat(
                                      metaDataBundle.amount
                                    ).toFixed(2)}</div>
                                </div>
                            </div>
                        
                            <div style="display: flex;flex-direction: row;justify-content: space-between;margin-top: 30px;align-items: center;width:100%">
                                <div style="flex:1;color:#272626bb;font-size: 12px;padding-right: 30px;min-width:150px;">Thank you for choosing TaxiConnect for all your business delivery needs.</div>
                                
                                <di class="u-col u_column" style="flex:2;display:flex;flex-direction:column;width:70%;">
                                  <table style="width:100%;">
                                      <tr>
                                          <div style="display:flex;flex-direction:row;justify-content: space-between;align-items: center;margin-bottom: 5px;width:100%;">
                                              <div style="font-weight: bold;font-size:11px;width:50%;position:relative;top:5px;text-align:left;">SUBTOTAL</div>
                                              <div style="font-size: 14px;color:#272626bb;width:50%;text-align:right;position:relative;bottom:3px">$${parseFloat(
                                                metaDataBundle.amount
                                              ).toFixed(2)}</div>
                                          </div>
                                      </tr>
                                      <tr>
                                          <div style="display:flex;flex-direction:row;justify-content: space-between;align-items: center;margin-bottom: 5px;">
                                              <div style="font-weight: bold;font-size:11px;width:50%;position:relative;top:5px">TAXABLE</div>
                                              <div style="font-size: 14px;color:#272626bb;width:50%;text-align:right;position:relative;bottom:3px">$${amountRecomputed.toFixed(
                                                2
                                              )}</div>
                                          </div>
                                      </tr>
                                      <tr>
                                          <div style="border-bottom:1px solid #d0d0d0;padding-bottom:10px;display:flex;flex-direction:row;justify-content: space-between;align-items: center;margin-bottom: 10px;">
                                              <div style="font-weight: bold;font-size:11px;width:50%;position:relative;top:5px">SERVICE FEE (4%)</div>
                                              <div style="font-size: 14px;color:#272626bb;width:50%;text-align:right;position:relative;bottom:3px">$${(
                                                parseFloat(
                                                  metaDataBundle.amount
                                                ) * 0.04
                                              ).toFixed(2)}</div>
                                          </div>
                                      </tr>
                                      <tr>
                                          <div style="border-bottom:1px solid #d0d0d0;padding-bottom:10px;display:flex;flex-direction:row;justify-content: space-between;align-items: center;margin-bottom: 15px;">
                                              <div style="font-weight: bold;font-size:11px;width:50%;position:relative;top:5px">TOTAL</div>
                                              <div style="font-size: 14px;color:#272626bb;width:50%;text-align:right;position:relative;bottom:3px">$${parseFloat(
                                                metaDataBundle.amount
                                              ).toFixed(2)}</div>
                                          </div>
                                      </tr>
                                      <tr>
                                          <div style="border-bottom:1px solid #d0d0d0;padding-bottom:10px;display:flex;flex-direction:row;justify-content: space-between;align-items: center;margin-bottom: 5px;">
                                              <div style="font-weight: bold;font-size:12px;flex:1;width:50%;position:relative;top:5px">BALANCE DUE</div>
                                              <div style="font-size: 15px;color:#272626bb;font-weight: bold;width:50%;text-align:right;position:relative;bottom:3px">NAD $${parseFloat(
                                                metaDataBundle.amount
                                              ).toFixed(2)}</div>
                                          </div>
                                      </tr>
                                  </table>
                                </div>
                            </div>
                        </div>
                            </div>

                          </div>
                        </div>

                      </div>
                    </div>
                  </div>

                </div>

              </body>

              </html>
        `;

              //? Save the email dispatch event
              new Promise((saveEvent) => {
                let eventBundle = {
                  event_name: "Delivery_package_email_receipt_dipstach",
                  user_fingerprint: metaDataBundle.user_fp,
                  user_nature: "rider",
                  city: "Windhoek",
                  receipt_fp: receiptFp,
                  email_data: emailTemplate,
                  date: new Date(chaineDateUTC),
                };
                //...
                collectionGlobalEvents.insertOne(
                  eventBundle,
                  function (err, reslt) {
                    if (err) {
                      logger.error(err);
                      saveEvent(false);
                    }
                    //...
                    saveEvent(true);
                  }
                );
              })
                .then()
                .catch((error) => logger.error(error));

              //? Send email
              let info = transporterNoReplay.sendMail({
                from: process.env.NOREPLY_EMAIL, // sender address
                to: companyData.email, // list of receivers
                subject: `Delivery Package purchase receipt (${receiptFp})`, // Subject line
                html: emailTemplate,
              });

              //?DONE
              logger.info(`Sending receipt email...to ${companyData.email}`);
              logger.info(info.messageId);
              resolve(true);
            });
        } //Unknown company
        else {
          resolve(false);
        }
      });
  } else {
    resolve(false);
  }
}

/**
 * MAIN
 */

var collectionDedicatedServices_accounts = null;
var collectionPassengers_profiles = null;
var collectionDrivers_profiles = null;
var collectionWalletTransactions_logs = null;
var collectionRidesDeliveryData = null;
var collectionGlobalEvents = null;

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
        logger.info("[*] Payments services up");
        const dbMongo = clientMongo.db(process.env.DB_NAME_MONGODDB);
        collectionPassengers_profiles = dbMongo.collection(
          "passengers_profiles"
        ); //Hold the information about the riders
        collectionDrivers_profiles = dbMongo.collection("drivers_profiles"); //Hold all the drivers profiles
        collectionWalletTransactions_logs = dbMongo.collection(
          "wallet_transactions_logs"
        ); //Hold the latest information about the riders topups
        collectionRidesDeliveryData = dbMongo.collection(
          "rides_deliveries_requests"
        ); //Hold all the requests made (rides and deliveries)
        collectionGlobalEvents = dbMongo.collection("global_events"); //Hold all the random events that happened somewhere.
        collectionDedicatedServices_accounts = dbMongo.collection(
          "dedicated_services_accounts"
        ); //Hold all the accounts for dedicated servics like deliveries, etc.
        //-------------
        app
          .get("/", function (req, res) {
            logger.info("Payments services up");
          })
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

        /**
         * WALLET TOP-UP
         * Responsible for topping up wallets and securing the all process
         */
        app.get("/topUPThisWalletTaxiconnect", function (req, res) {
          resolveDate();
          //...
          /*let dataBundle = {
            user_fp:
              "7c57cb6c9471fd33fd265d5441f253eced2a6307c0207dea57c987035b496e6e8dfa7105b86915da",
            amount: 45,
            number: 1,
            expiry: 1,
            cvv: 1,
            name: "Dominique", //? Optional
            type: "VISA",
          };*/
          // let params = urlParser.parse(req.url, true);
          req = req.body;
          //? Make sure that the city and country are provided or - defaults them to Windhoek Namibia
          req.city =
            req.city !== undefined && req.city !== null && req.city !== false
              ? req.city
              : "Windhoek";
          req.country =
            req.country !== undefined &&
            req.country !== null &&
            req.country !== false &&
            req.country.length <= 2
              ? req.country
              : "NA"; //! Required 2 digits for countries - DPO ref
          //?....
          dataBundle = req;

          //! CHECK INPUTS
          if (
            dataBundle.user_fp !== undefined &&
            dataBundle.user_fp !== null &&
            dataBundle.amount !== undefined &&
            dataBundle.amount !== null &&
            dataBundle.number !== undefined &&
            dataBundle.number !== null &&
            dataBundle.expiry !== undefined &&
            dataBundle.expiry !== null &&
            dataBundle.cvv !== undefined &&
            dataBundle.cvv !== null &&
            dataBundle.type !== undefined &&
            dataBundle.type !== null &&
            dataBundle.name !== undefined &&
            dataBundle.name !== null &&
            dataBundle.city !== undefined &&
            dataBundle.city !== null &&
            dataBundle.country !== undefined &&
            dataBundle.country !== null
          ) {
            //?PASSED
            //Get user's details
            //! Use dynamic user finding based on the scope of the user (normal/corporate) [request_globality]
            let dynamicRequesterFetcher =
              /normal/i.test(dataBundle.request_globality) ||
              dataBundle.request_globality === undefined
                ? collectionPassengers_profiles.find({
                    user_fingerprint: dataBundle.user_fp,
                  })
                : collectionDedicatedServices_accounts.find({
                    company_fp: dataBundle.user_fp,
                  });
            //...
            logger.warn(dataBundle);
            dynamicRequesterFetcher.toArray(function (error, usersDetails) {
              if (error) {
                logger.info(error);
                res.send({ response: false, message: "transaction_error" });
              }
              //...
              let dynamicConds =
                /normal/i.test(dataBundle.request_globality) ||
                dataBundle.request_globality === undefined
                  ? usersDetails.length > 0 &&
                    usersDetails[0].user_fingerprint !== undefined &&
                    usersDetails[0].user_fingerprint !== null
                  : usersDetails.length > 0 &&
                    usersDetails[0].company_fp !== undefined &&
                    usersDetails[0].company_fp !== null;
              //...
              if (dynamicConds) {
                //?Found some valid details
                //...
                //! LIMIT THE TRANSACTION AMOUNT TO N$1000 (N$50-N$1000)
                //? Make dynamic limit based on the request globality
                let maxAmountLimit =
                  /normal/i.test(dataBundle.request_globality) ||
                  dataBundle.request_globality === undefined
                    ? 1000
                    : 15000;
                //...
                if (
                  parseFloat(dataBundle.amount) >= 50 &&
                  parseFloat(dataBundle.amount) <= maxAmountLimit
                ) {
                  //? Remove _ from the name
                  dataBundle.name = dataBundle.name.replace(/_/g, " ");
                  //CREATE TOKEN
                  new Promise((resolve) => {
                    //? XML TOKEN responsible for creating a transaction token before any payment.
                    let xmlCreateToken = `
                      <?xml version="1.0" encoding="utf-8"?>
                      <API3G>
                      <CompanyToken>${
                        /^enabled/i.test(process.env.DEV_DELIVERY_STATE) &&
                        /corporate/i.test(dataBundle.request_globality)
                          ? process.env.DEV_TOKEN_PAYMENT_CP
                          : process.env.TOKEN_PAYMENT_CP
                      }</CompanyToken>
                      <Request>createToken</Request>
                      <Transaction>
                      <PaymentAmount>${dataBundle.amount}</PaymentAmount>
                      <customerCountry>${
                        dataBundle.country !== undefined &&
                        dataBundle.country !== null &&
                        dataBundle.country !== "false"
                          ? dataBundle.country
                          : "Namibia"
                      }</customerCountry>
                      <customerCity>${
                        dataBundle.city !== undefined &&
                        dataBundle.city !== null &&
                        dataBundle.city !== "false"
                          ? dataBundle.city
                          : "Windhoek"
                      }</customerCity>
                      <CardHolderName>${dataBundle.name}</CardHolderName>
                      <PaymentCurrency>${
                        process.env.PAYMENT_CURRENCY
                      }</PaymentCurrency>
                      <CompanyRef>${
                        /^enabled/i.test(process.env.DEV_DELIVERY_STATE) &&
                        /corporate/i.test(dataBundle.request_globality)
                          ? process.env.DEV_COMPANY_DPO_REF
                          : process.env.COMPANY_DPO_REF
                      }</CompanyRef>
                      <RedirectURL>${
                        process.env.REDIRECT_URL_AFTER_PROCESSES
                      }</RedirectURL>
                      <BackURL>${
                        process.env.REDIRECT_URL_AFTER_PROCESSES
                      }</BackURL>
                      <CompanyRefUnique>0</CompanyRefUnique>
                      <PTL>5</PTL>
                      </Transaction>
                      <Services>
                        <Service>
                          <ServiceType>${
                            /^enabled/i.test(process.env.DEV_DELIVERY_STATE) &&
                            /corporate/i.test(dataBundle.request_globality)
                              ? process.env.DEV_DPO_CREATETOKEN_SERVICE_TYPE
                              : process.env.DPO_CREATETOKEN_SERVICE_TYPE
                          }</ServiceType>
                          <ServiceDescription>TaxiConnect wallet top-up</ServiceDescription>
                          <ServiceDate>${dateObjectImute}</ServiceDate>
                        </Service>
                      </Services>
                      </API3G>
                      `;

                    createPaymentTransaction(
                      xmlCreateToken,
                      dataBundle.user_fp,
                      collectionWalletTransactions_logs,
                      resolve
                    );
                  }).then(
                    (reslt) => {
                      //Deduct XML response
                      new Promise((resolve) => {
                        deductXML_responses(reslt, "createToken", resolve);
                      }).then(
                        (result_createTokenDeducted) => {
                          if (result_createTokenDeducted !== false) {
                            //? Continue the top-up process
                            new Promise((resFollower) => {
                              processExecute_paymentCardWallet_topup(
                                dataBundle,
                                result_createTokenDeducted,
                                collectionWalletTransactions_logs,
                                collectionPassengers_profiles,
                                collectionGlobalEvents,
                                resFollower
                              );
                            }).then(
                              (result_final) => {
                                res.send(result_final); //!Remove dpoFinal object and remove object bracket form!
                              },
                              (error) => {
                                logger.info(error);
                                res.send({
                                  response: false,
                                  message: "transaction_error",
                                });
                              }
                            );
                          } //Error
                          else {
                            res.send({
                              response: false,
                              message: "transaction_error",
                            });
                          }
                        },
                        (error) => {
                          logger.info(error);
                          res.send({
                            response: false,
                            message: "token_error",
                          });
                        }
                      );
                    },
                    (error) => {
                      logger.info(error);
                      res.send({ response: false, message: "token_error" });
                    }
                  );
                } //! AMOUNT TOO LARGE - DECLINE
                else {
                  res.send({
                    response: false,
                    message: "transaction_error_exceeded_limit",
                  });
                }
              } //?Strange - did not find a rider account linked to this request
              else {
                logger.info("Not found users");
                //Save error event log
                new Promise((resFailedTransaction) => {
                  let faildTransObj = {
                    event_name: "unlinked_rider_account_topup_failed_trial",
                    user_fingerprint: dataBundle.user_fp,
                    inputData: dataBundle,
                    date_captured: new Date(chaineDateUTC),
                  };
                  //...
                  collectionGlobalEvents.insertOne(
                    faildTransObj,
                    function (err, reslt) {
                      resFailedTransaction(true);
                    }
                  );
                }).then(
                  () => {},
                  () => {}
                );
                //...
                res.send({ response: false, message: "transaction_error" });
              }
            });
          } //Invalid input data
          else {
            res.send({
              response: false,
              message: "transaction_error_missing_details",
            });
          }
        });

        /**
         * CHECK RECEIVER'S DETAIL
         * Responsible for checking the receiver's details while making a wallet transaction.
         * ? Friends/Family: Phone number (Check if it's an active TaxiConnect number).
         * ? Drivers: Check the payment number (or Taxi number) - 5 digits number.
         * ? User nature: friend or driver ONLY.
         */
        app.get("/checkReceiverDetails_walletTransaction", function (req, res) {
          resolveDate();
          let params = urlParser.parse(req.url, true);
          req = params.query;
          logger.info(req);

          if (
            req.user_fingerprint !== undefined &&
            req.user_fingerprint !== null &&
            req.user_nature !== undefined &&
            req.user_nature !== null &&
            req.payNumberOrPhoneNumber !== undefined &&
            req.payNumberOrPhoneNumber !== null
          ) {
            //Valid infos
            //! CHECK IF THE USER IS NOT SENDING TO HIMSELF
            new Promise((resCheckValidSender) => {
              checkNonSelf_sendingFunds_user(
                collectionPassengers_profiles,
                req.payNumberOrPhoneNumber,
                req.user_nature,
                req.user_fingerprint,
                resCheckValidSender
              );
            }).then(
              (resultCheckSender) => {
                if (
                  resultCheckSender.response !== undefined &&
                  resultCheckSender.response &&
                  /^valid_sender$/i.test(resultCheckSender.flag)
                ) {
                  //Valid sender
                  new Promise((resolve) => {
                    checkReceipient_walletTransaction(
                      req,
                      collectionPassengers_profiles,
                      collectionDrivers_profiles,
                      collectionGlobalEvents,
                      resolve
                    );
                  }).then(
                    (result) => {
                      res.send(result);
                    },
                    (error) => {
                      logger.info(error);
                      res.send({
                        response: "error",
                        flag: "transaction_error",
                      });
                    }
                  );
                } //! The user wants to send to himself
                else {
                  res.send({
                    response: "error",
                    flag: "transaction_error_want_toSend_toHiHermslef",
                  });
                }
              },
              (error) => {
                logger.info(error);
                res.send({ response: "error", flag: "transaction_error" });
              }
            );
          } //Invalid infos
          else {
            res.send({
              response: "error",
              flag: "transaction_error_invalid_information",
            });
          }
        });

        /**
         * SEND FUNDS FROM WALLET
         * Responsible for sending funds from the rider's wallet to friends/family or drivers.
         * ? Amount (No more than N$1000), user nature, user_fingerprint (sender), payNumberOrPhoneNumber (phone number, payment number/taxi number).
         */
        app.get("/sendMoney_fromWalletRider_transaction", function (req, res) {
          resolveDate();
          let params = urlParser.parse(req.url, true);
          req = params.query;
          logger.info(req);
          //...
          if (
            req.user_fingerprint !== undefined &&
            req.user_fingerprint !== null &&
            req.amount !== undefined &&
            req.amount !== null &&
            req.user_nature !== undefined &&
            req.user_nature !== null &&
            req.payNumberOrPhoneNumber !== undefined &&
            req.payNumberOrPhoneNumber !== null
          ) {
            //! Valid infos
            new Promise((resolve) => {
              checkReceipient_walletTransaction(
                req,
                collectionPassengers_profiles,
                collectionDrivers_profiles,
                collectionGlobalEvents,
                resolve,
                true
              );
            }).then(
              (result) => {
                if (
                  /verified/i.test(result.response) &&
                  result.recipient_fp !== null &&
                  result.recipient_fp !== undefined
                ) {
                  //Active user
                  //ADD THE RECIPIENT FINGERPRINT
                  req["recipient_fp"] = result.recipient_fp;
                  //! CHECK THAT THE USER IS NOT SENDING TO HIMSELF
                  new Promise((resCheckValidSender) => {
                    checkNonSelf_sendingFunds_user(
                      collectionPassengers_profiles,
                      req.payNumberOrPhoneNumber,
                      req.user_nature,
                      req.user_fingerprint,
                      resCheckValidSender
                    );
                  }).then(
                    (resultCheckSender) => {
                      if (
                        resultCheckSender.response !== undefined &&
                        resultCheckSender.response &&
                        /^valid_sender$/i.test(resultCheckSender.flag)
                      ) {
                        //Valid sender
                        //! CHECK THE WALLET BALANCE FOR THE SENDER, it should be >= to the amount to send
                        new Promise((resCheckBalance) => {
                          let url =
                            `${
                              /production/i.test(process.env.EVIRONMENT)
                                ? `http://${process.env.INSTANCE_PRIVATE_IP}`
                                : process.env.LOCAL_URL
                            }` +
                            ":" +
                            process.env.ACCOUNTS_SERVICE_PORT +
                            "/getRiders_walletInfos?user_fingerprint=" +
                            req.user_fingerprint +
                            "&mode=total&avoidCached_data=true";

                          requestAPI(url, function (error, response, body) {
                            if (error === null) {
                              try {
                                body = JSON.parse(body);
                                resCheckBalance(body);
                              } catch (error) {
                                resCheckBalance({
                                  total: 0,
                                  response: "error",
                                  tag: "invalid_parameters",
                                });
                              }
                            } else {
                              resCheckBalance({
                                total: 0,
                                response: "error",
                                tag: "invalid_parameters",
                              });
                            }
                          });
                        }).then(
                          (senderBalance_infos) => {
                            if (
                              !/error/i.test(senderBalance_infos.response) &&
                              senderBalance_infos.total !== undefined &&
                              senderBalance_infos.total !== null
                            ) {
                              //Good to Go
                              if (
                                parseFloat(senderBalance_infos.total) >=
                                parseFloat(req.amount)
                              ) {
                                //? Has enough funds
                                new Promise((resolve) => {
                                  execSendMoney_fromRiderWallet_transaction(
                                    req,
                                    collectionWalletTransactions_logs,
                                    resolve
                                  );
                                }).then(
                                  (result) => {
                                    res.send(result);
                                  },
                                  (error) => {
                                    logger.info(error);
                                    res.send({
                                      response: "error",
                                      flag: "transaction_error",
                                    });
                                  }
                                );
                              } //! The sender has not enough funds in his/her wallet to proceed
                              else {
                                res.send({
                                  response: "error",
                                  flag: "transaction_error_unsifficient_funds",
                                });
                              }
                            } //Error getting the sender's total wallet amount
                            else {
                              res.send({
                                response: "error",
                                flag: "transaction_error",
                              });
                            }
                          },
                          (error) => {
                            //Error getting balance information
                            logger.info(error);
                            res.send({
                              response: "error",
                              flag: "transaction_error",
                            });
                          }
                        );
                      } //! The user wants to send to himself
                      else {
                        res.send({
                          response: "error",
                          flag: "transaction_error_want_toSend_toHiHermslef",
                        });
                      }
                    },
                    (error) => {
                      logger.info(error);
                      res.send({
                        response: "error",
                        flag: "transaction_error",
                      });
                    }
                  );
                } //No recipient found
                else {
                  res.send({
                    response: "error",
                    flag: "transaction_error",
                  });
                }
              },
              (error) => {
                logger.info(error);
                res.send({ response: "error", flag: "transaction_error" });
              }
            );
          } else {
            res.send({ response: "error", flag: "transaction_error" });
          }
        });
      }
    );
  }
);

server.listen(process.env.PAYMENT_SERVICE_PORT);
