let filterReceived = {
  user_fingerprint:
    "7f5cdbd2ad103385b4dd9fc8651bc55a3df6a49c031563f52b2ce78734eb3b2856b68cff466cbfb1",
  transaction_nature: {
    $in: [
      "sentToFriend",
      "paidDriver",
      "sentToDriver",
      "weeklyPaidDriverAutomatic",
      "commissionTCSubtracted",
      "onetime_voucher", //? For the reward - onetime voucher
    ],
    // $lte: 56,
    // $gte: new Date(),
  },
  "key1.key3.key4.key5": 100,
  //   amount: {
  //     $gte: 25,
  //     $lte: 30,
  //   },
}; //?Indexed

let remapped_filter = [];

//? Static operations
let STATIC_OPERATIONS_MAP = {
  $in: "INCLUDES",
  $not: "EXCLUDES",
  $gte: "GREATER_THAN_EQUAL",
  $lte: "LESS_THAN_EQUAL",
};

Object.keys(filterReceived).forEach(function (key) {
  //...
  //! Fill in the op
  if (
    typeof filterReceived[key] === "string" ||
    typeof filterReceived[key] === "boolean" ||
    typeof filterReceived[key] === "bigint" ||
    typeof filterReceived[key] === "number"
  ) {
    //Normal String or bool, or number
    let tmpSubFilter = {
      op: null,
      key: key,
      value: null,
    };
    //...
    tmpSubFilter.op = "MATCH";
    tmpSubFilter.value = filterReceived[key];
    //? Save
    remapped_filter.push(tmpSubFilter);
  } else if (typeof filterReceived[key] === "object") {
    //Object
    Object.keys(filterReceived[key]).forEach(function (key2) {
      let tmpSubFilter = {
        op: null,
        key: key,
        value: null,
      };
      //...
      tmpSubFilter.op = STATIC_OPERATIONS_MAP[key2];
      tmpSubFilter.value = filterReceived[key][key2];
      //? Save
      remapped_filter.push(tmpSubFilter);
    });
  }
});

console.log(remapped_filter);

/**
 * @func getDeepKeysValues
 * Responsible for getting the litteral object's deep values.
 * @param originalObject: the untouched object
 * @param keyString: the comma separated keys to get
 */
function getDeepKeysValues(originalObject, keyString) {
  let result = null;

  keyString.split(".").map((el) => {
    result =
      result !== null && result !== undefined ? result[el] : originalObject[el];
    return true;
  });
  return result;
}

/**
 * @func MAP_to_LOGIC
 * Responsible for converting the given map to more understandable logic resulting to a true of false value.
 * @param remapped_data: the remapped data
 * @param single_data: the data to be processed.
 */
async function MAP_to_LOGIC(remapped_data, single_data) {
  let arrayBools = [];

  remapped_data.map((remapped) => {
    switch (remapped.op) {
      case "MATCH":
        arrayBools.push(
          getDeepKeysValues(single_data, remapped.key) === remapped.value
        );
        break;

      case "INCLUDES":
        arrayBools.push(
          remapped.value.includes(getDeepKeysValues(single_data, remapped.key))
        );
        break;

      case "LESS_THAN_EQUAL":
        if (typeof remapped.value) {
          //If object - take as date
          arrayBools.push(
            new Date(getDeepKeysValues(single_data, remapped.key)) <=
              remapped.value
          );
        } //Take as number
        else {
          arrayBools.push(
            getDeepKeysValues(single_data, remapped.key) <= remapped.value
          );
        }
        break;

      case "GREATER_THAN_EQUAL":
        if (typeof remapped.value) {
          //If object - take as date
          arrayBools.push(
            new Date(getDeepKeysValues(single_data, remapped.key)) >=
              remapped.value
          );
        } //Take as number
        else {
          arrayBools.push(
            getDeepKeysValues(single_data, remapped.key) >= remapped.value
          );
        }
        break;

      default:
        break;
    }
  });

  //! Done
  return arrayBools;
}

console.log(
  MAP_to_LOGIC(remapped_filter, {
    _id: { $oid: "60a395cc1a0dbe2c9943d686" },
    payment_currency: "NAD",
    transaction_nature: "weeklyPaidDriverAutomatic",
    user_fingerprint:
      "7f5cdbd2ad103385b4dd9fc8651bc55a3df6a49c031563f52b2ce78734eb3b2856b68cff466cbfb1",
    amount: 30,
    key1: {
      key2: "here",
      key3: {
        key4: {
          key5: 100,
        },
      },
    },
  })
);
