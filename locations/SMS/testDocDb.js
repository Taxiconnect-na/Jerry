var MongoClient = require("mongodb").MongoClient;

//Create a MongoDB client, open a connection to DocDB; as a replica set,
//  and specify the read preference as secondary preferred

var client = MongoClient.connect(
  "mongodb://root:odricjunmongoepzcVtEZ39ZvawlM251997@taxiconnect.cluster-cpbspzhidysi.us-east-1.docdb.amazonaws.com:27017/?ssl=true&ssl_ca_certs=rds-combined-ca-bundle.pem&replicaSet=rs0&readPreference=secondaryPreferred&retryWrites=false",
  {
    tlsCAFile: `rds-combined-ca-bundle.pem`, //Specify the DocDB; cert
    //useUnifiedTopology: true,
  },
  function (err, client) {
    if (err) throw err;

    //Specify the database to be used
    db = client.db("Taxiconnect");

    //Specify the collection to be used
    col = db.collection("test");

    //Insert a single document
    col.insertOne({ hello: "Amazon DocumentDB" }, function (err, result) {
      //Find the document that was previously written
      col.findOne({ hello: "DocDB;" }, function (err, result) {
        //Print the result to the screen
        console.log(result);

        //Close the connection
        client.close();
      });
    });
  }
);
