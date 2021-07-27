const express = require("express");
const app = express();
const server = require("http").createServer(app);
const port = 9000;
const pointsItinary = [
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

var usedUpItinerayData = [];

app
  .use(express.json())
  .use(express.urlencoded({ extended: true }))
  .get("/", (req, res) => {
    res.send("Basic server for ride scenarios!");
  })
  .get("/getData", (req, res) => {
    //console.log("App requesting for data...");
    //Simulate moving forward data from the initial polyline array.
    if (usedUpItinerayData.length > 0) {
      usedUpItinerayData.shift();
    } //Fill
    else {
      usedUpItinerayData = pointsItinary.slice();
    }
    //...
    console.log(usedUpItinerayData.length);
    console.log(usedUpItinerayData);
    res.send({ route: usedUpItinerayData });
  });

server.listen(port, () => {
  console.log(`Basic server listening at http://localhost:${port}`);
});
