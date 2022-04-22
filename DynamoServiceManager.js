/**
 * Responsible for performing the following DynamoDB operations:
 * ! The primary key for every tables is the _id
 * 1. Insert
 * 2. Delete
 * 3. Update
 */

const { logger } = require("./LogService");

var AWS = require("aws-sdk");
const { v4: uuidv4 } = require("uuid");
// Set the region
AWS.config.update({ region: "us-east-1", endpoint: "http://localhost:8000" });

// Create DynamoDB document client
var dynamoClient = new AWS.DynamoDB.DocumentClient({
  apiVersion: "2012-08-10",
});

/**
 * ? Insert: PUT
 * Add a new record in a desired table
 * @param table_name: the name of the table that the record needs to be inserted in
 * @param data: the data to be inserted
 */
async function insert(table_name, data) {
  //! Attach a new _id if unexistant
  data["_id"] =
    data["_id"] !== undefined && data["_id"] !== null ? data["_id"] : uuidv4();
  //...
  let params = {
    TableName: table_name,
    Item: data,
  };
  //...
  dynamoClient.put(params, function (err, resultPut) {
    if (err) {
      logger.error(err);
      return false;
    }
    //...
    logger.info(resultPut);
    return true;
  });
}

/**
 * ? Delete
 * Delete a record from a desired table
 * @param table_name: the name of the table from which the record will be deleted.
 * @param _idKey: the filtering data to be deleted
 */
async function delete_r(table_name, _idKey) {
  let params = {
    TableName: table_name,
    Key: {
      _id: _idKey,
    },
  };
  //...
  dynamoClient.delete(params, function (err, resultDel) {
    if (err) {
      logger.error(err);
      return false;
    }
    //...
    logger.info(resultDel);
    return true;
  });
}

/**
 * ? Update
 * Update a record from a desired table
 * @param table_name: the name of the table from which the record will be updated.
 * @param _idKey: the filtering data to be updated
 * @param UpdateExpression: the expression schema to be updated.
 * @param ExpressionAttributeValues: the attributes to complete the update expression
 * @param ExpressionAttributeNames: the names of the attributes, very useful for nested attributes.
 */
async function update(
  table_name,
  _idKey,
  UpdateExpression,
  ExpressionAttributeValues = {},
  ExpressionAttributeNames = {}
) {
  let params = {
    TableName: table_name,
    Key:
      typeof _idKey === "object"
        ? _idKey
        : {
            _id: _idKey,
          },
    UpdateExpression: UpdateExpression,
    ExpressionAttributeValues: ExpressionAttributeValues,
    ExpressionAttributeNames: ExpressionAttributeNames,
  };
  //...
  dynamoClient.update(params, function (err, resultUpdate) {
    if (err) {
      logger.error(err);
      return false;
    }
    //...
    logger.info(resultUpdate);
    return true;
  });
}

//? Exports
module.exports = {
  dynamo_insert: insert,
  dynamo_delete: delete_r,
  dynamo_update: update,
  get_newID: () => {
    return uuidv4();
  },
};
