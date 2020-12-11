/*let arrayDummy = new Array(1000000).fill(1); //Simulate 9000 consecutive ride requests

arrayDummy.map((user, index) => {
  
});*/
var dash = require("appmetrics-dash");
var index = 0;

const express = require("express");
const http = require("http");
const app = express();
var server = http.createServer(app);
const port = 9999;

const bodyParser = require("body-parser");

app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));

app.get("/stagedDispatch", (req, response) => {
  index++;
  console.log("REQUEST TICKET " + index);
  new Promise((res) => {
    //Asnwer
    response.writeHead(200);
    response.end("REQUESTED TICKET CONFIRMATION " + index);
    console.log("[1] Closest drivers ---ticket: " + index);
    //1. Wait for 1 min 30'' - in ms
    console.log("Waiting for 1min 30. ---ticket: " + index);
    setTimeout(() => {
      new Promise((res2) => {
        console.log("[2] Less closest after 1min 30. ---ticket: " + index);
        //Allow these drivers to see the requests athen resolve 2
        res(true); //Conclude promise 1
        res2(true); //Conclude promise 2
      })
        .then()
        .finally(() => {
          //2. Wait for 1 min
          console.log("Waiting for 1min ---ticket: " + index);
          setTimeout(() => {
            new Promise((res3) => {
              console.log("[3] Less*2 closest after 1 min. ---ticket: " + index);
              //Allow these drivers to see the requests athen resolve 3
              res3(true); //Conclude promise 3
            })
              .then()
              .finally(() => {
                //3. Wait for 1 min
                console.log("Waiting for 1min ---ticket: " + index);
                setTimeout(() => {
                  new Promise((res4) => {
                    console.log("[4] Less*3 closest after 1 min. ---ticket: " + index);
                    //Allow these drivers to see the requests athen resolve 4
                    res4(true); //Conclude promise 4
                  })
                    .then()
                    .finally(() => {
                      console.log("DONE STAGED DISPATCH  ---ticket: " + index);
                      //Resolve some main resolver or something
                    });
                }, 1 * 60 * 1000);
              });
          }, 1 * 60 * 1000);
        });
    }, 90 * 1000);
  });
});

server.listen(port, () => {
  console.log("Staged dispatch prototype listening on port 9999");
}); // Démarre le serveur

dash.monitor({ server: server });
