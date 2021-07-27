// // Load the AWS SDK for Node.js
// var AWS = require("aws-sdk");
// // Set region
// AWS.config.update({ region: "us-east-1" });

// // Create publish parameters
// var params = {
//   Message: "It looks pretty cool, I know" /* required */,
//   PhoneNumber: "264856997167",
// };

// // Create promise and SNS service object
// var publishTextPromise = new AWS.SNS({ apiVersion: "2010-03-31" })
//   .publish(params)
//   .promise();

// // Handle promise's fulfilled/rejected states
// publishTextPromise
//   .then(function (data) {
//     console.log(data);
//   })
//   .catch(function (err) {
//     console.error(err, err.stack);
//   });
let data = [
  [17.081366, -22.560857],
  [17.08134, -22.560909],
  [17.081398, -22.561636],
  [17.081354, -22.562194],
  [17.081073, -22.564413],
  [17.080976, -22.565102],
  [17.080986, -22.565337],
  [17.080997, -22.565413],
  [17.081044, -22.565621],
  [17.081163, -22.565976],
  [17.081548, -22.567192],
  [17.081562, -22.567237],
  [17.081713, -22.567711],
  [17.081803, -22.567989],
  [17.081945, -22.568441],
  [17.08203, -22.568701],
  [17.082083, -22.568895],
  [17.082128, -22.569076],
  [17.082141, -22.569315],
  [17.082131, -22.569783],
  [17.08213, -22.569842],
  [17.08212, -22.570049],
  [17.082102, -22.570316],
  [17.082032, -22.571517],
  [17.082011, -22.571665],
  [17.081874, -22.571703],
  [17.080883, -22.571956],
  [17.080848, -22.572097],
  [17.079999, -22.57396],
  [17.079538, -22.574973],
  [17.079128, -22.575917],
  [17.07908, -22.576019],
];

data.map((el) => {
  console.log(`LatLng(${el[1]}, ${el[0]}),`);
});

console.log("POLYLINE");
data.map((el) => {
  console.log(`points.add(LatLng(${el[1]}, ${el[0]}));`);
});

console.log("RAW POINTS");
data.map((el) => {
  console.log(`[${el[1]}, ${el[0]}],`);
});
